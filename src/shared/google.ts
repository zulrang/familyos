import { AuthError } from "@/shared/auth-error";
import { googleClient } from "@/shared/google-env";
import {
  establishProviderConnection,
  patchProvider,
  readProvider,
  type Tokens,
} from "@/shared/provider";

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

export function authUrl(state: string): string {
  const { id, redirect } = googleClient();
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

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}`);
  return res.json();
}

async function googleAccountId(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  const data = (await res.json()) as { sub?: string };
  if (!data.sub) throw new Error("userinfo missing sub");
  return data.sub;
}

export async function exchangeCode(code: string): Promise<void> {
  const { id, secret, redirect } = googleClient();
  const cur = await readProvider();
  const tok = await tokenRequest({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  const tokens: Tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? cur.tokens?.refresh_token ?? "",
    expiry: Date.now() + tok.expires_in * 1000,
  };
  const accountId = await googleAccountId(tokens.access_token);
  await establishProviderConnection(accountId, tokens);
}

async function accessToken(): Promise<string> {
  const s = await readProvider();
  if (!s.tokens?.access_token) throw new AuthError();
  if (s.tokens.expiry - 60_000 > Date.now()) return s.tokens.access_token;
  if (!s.tokens.refresh_token) throw new AuthError();
  const { id, secret } = googleClient();
  const tok = await tokenRequest({
    refresh_token: s.tokens.refresh_token,
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
  });
  const next: Tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? s.tokens.refresh_token,
    expiry: Date.now() + tok.expires_in * 1000,
  };
  await patchProvider({ tokens: next });
  return next.access_token;
}

export { AuthError } from "@/shared/auth-error";

export async function gfetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) throw new AuthError();
  if (res.status === 403 && url.includes("tasks.googleapis.com")) {
    throw new AuthError();
  }
  return res;
}
