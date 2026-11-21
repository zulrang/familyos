import path from "node:path";
import { AuthError } from "@/shared/auth-error";
import { dataDir } from "@/shared/data-path";
import { googleClient } from "@/shared/google-env";
import {
  clearProviderConnectionIfMatching,
  commitRefreshedTokens,
  establishProviderConnection,
  type RefreshTarget,
  readProvider,
  type Tokens,
} from "@/shared/provider";

export const GOOGLE_API_TIMEOUT_MS = 10_000;
export const GOOGLE_MEDIA_TIMEOUT_MS = 30_000;

export type GoogleFetchInit = RequestInit & { timeoutMs?: number };

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
].join(" ");

export function authUrl(state: string, redirect: string): string {
  const { id } = googleClient();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(
  body: Record<string, string>,
  timeoutMs = GOOGLE_API_TIMEOUT_MS,
): Promise<
  | {
      ok: true;
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }
  | { ok: false; status: number; body: string }
> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    return { ok: false, status: res.status, body: text };
  }
  return { ok: true, ...(await res.json()) };
}

function tokenError(status: number, body: string): Error {
  return new Error(`Google token error ${status}${body ? ` ${body}` : ""}`);
}

function isInvalidGrant(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      parsed.error === "invalid_grant"
    );
  } catch {
    return false;
  }
}

async function googleAccountId(
  accessToken: string,
  timeoutMs = GOOGLE_API_TIMEOUT_MS,
): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  const data = (await res.json()) as { sub?: string };
  if (!data.sub) throw new Error("userinfo missing sub");
  return data.sub;
}

export async function exchangeCode(
  code: string,
  redirect: string,
): Promise<void> {
  const { id, secret } = googleClient();
  const cur = await readProvider();
  const tok = await tokenRequest({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  if (!tok.ok) throw tokenError(tok.status, tok.body);
  const tokens: Tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? cur.tokens?.refresh_token ?? "",
    expiry: Date.now() + tok.expires_in * 1000,
  };
  const accountId = await googleAccountId(tokens.access_token);
  await establishProviderConnection(accountId, tokens);
}

const inFlightRefreshes = new Map<string, Promise<string>>();

async function refreshAccessToken(
  expected: RefreshTarget,
  timeoutMs: number,
): Promise<string> {
  const { id, secret } = googleClient();
  const tok = await tokenRequest(
    {
      refresh_token: expected.refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    },
    timeoutMs,
  );
  if (!tok.ok) {
    if (tok.status === 400 && isInvalidGrant(tok.body)) {
      await clearProviderConnectionIfMatching(expected);
      throw new AuthError();
    }
    throw tokenError(tok.status, tok.body);
  }
  const next: Tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? expected.refreshToken,
    expiry: Date.now() + tok.expires_in * 1000,
  };
  const committed = await commitRefreshedTokens(expected, next);
  if (!committed) throw new AuthError();
  return next.access_token;
}

async function accessToken(timeoutMs = GOOGLE_API_TIMEOUT_MS): Promise<string> {
  const s = await readProvider();
  if (!s.tokens?.access_token) throw new AuthError();
  if (s.tokens.expiry - 60_000 > Date.now()) return s.tokens.access_token;
  if (!s.tokens.refresh_token) throw new AuthError();
  const expected: RefreshTarget = {
    providerConnectionId: s.providerConnectionId,
    refreshToken: s.tokens.refresh_token,
  };
  const key = `${path.resolve(dataDir())}\0${s.providerConnectionId ?? ""}\0${s.tokens.refresh_token}`;
  const existing = inFlightRefreshes.get(key);
  if (existing) return existing;
  const promise = refreshAccessToken(
    expected,
    Math.min(timeoutMs, GOOGLE_API_TIMEOUT_MS),
  ).finally(() => {
    if (inFlightRefreshes.get(key) === promise) {
      inFlightRefreshes.delete(key);
    }
  });
  inFlightRefreshes.set(key, promise);
  return promise;
}

export { AuthError } from "@/shared/auth-error";

export async function gfetch(
  url: string,
  init?: GoogleFetchInit,
): Promise<Response> {
  const { timeoutMs = GOOGLE_API_TIMEOUT_MS, signal, ...rest } = init ?? {};
  if (signal?.aborted) throw signal.reason;
  const token = await accessToken(timeoutMs);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const res = await fetch(url, {
    ...rest,
    signal: combinedSignal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
  });
  if (res.status === 401) throw new AuthError();
  if (res.status === 403 && url.includes("tasks.googleapis.com")) {
    throw new AuthError();
  }
  return res;
}

export async function throwIfGoogleFailed(
  res: Response,
  what: string,
): Promise<void> {
  if (res.ok) return;
  const body = (await res.text()).slice(0, 400);
  throw new Error(`${what} ${res.status}${body ? ` ${body}` : ""}`);
}
