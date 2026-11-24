import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, test, vi } from "vitest";
import { AuthError } from "@/shared/auth-error";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function fetchAbortingWithSignal(
  onRequest?: (url: string, init?: RequestInit) => void,
): typeof fetch {
  return (input, init) =>
    new Promise<Response>((_resolve, reject) => {
      onRequest?.(String(input), init);
      const sig = init?.signal;
      if (!sig) return;
      if (sig.aborted) {
        reject(sig.reason);
        return;
      }
      sig.addEventListener("abort", () => reject(sig.reason), { once: true });
    });
}

describe("Google refresh grant, single-flight, and timeouts", () => {
  let dataRoot: string;
  let gfetch: typeof import("@/shared/google").gfetch;
  let clearProviderConnection: typeof import("@/shared/provider").clearProviderConnection;
  let establishProviderConnection: typeof import("@/shared/provider").establishProviderConnection;
  let readProvider: typeof import("@/shared/provider").readProvider;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  const origFetch = globalThis.fetch;

  async function seedExpiredTokens(
    refreshToken = "refresh-dead",
    providerConnectionId = "acct-google",
  ): Promise<void> {
    await writeProvider({
      tokens: {
        access_token: "expired-access",
        refresh_token: refreshToken,
        expiry: Date.now() - 1,
      },
      oauthState: null,
      providerConnectionId,
    });
  }

  async function seedValidTokens(): Promise<void> {
    await writeProvider({
      tokens: {
        access_token: "valid-access",
        refresh_token: "refresh-live",
        expiry: Date.now() + 600_000,
      },
      oauthState: null,
      providerConnectionId: "acct-google",
    });
  }

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-google-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";

    ({ gfetch } = await import("@/shared/google"));
    ({
      clearProviderConnection,
      establishProviderConnection,
      readProvider,
      writeProvider,
    } = await import("@/shared/provider"));

    await mkdir(dataRoot, { recursive: true });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test("invalid_grant on refresh signs out and throws AuthError", async () => {
    await seedExpiredTokens();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        });
      }
      return new Response("{}", { status: 200 });
    };

    await assert.rejects(() => gfetch(CALENDAR_URL), AuthError);
    const provider = await readProvider();
    assert.equal(provider.tokens, null);
    assert.equal(provider.providerConnectionId, "acct-google");
  });

  test("a non-invalid_grant token 400 does not clear tokens", async () => {
    await seedExpiredTokens();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        return new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 400,
        });
      }
      return new Response("{}", { status: 200 });
    };

    await assert.rejects(() => gfetch(CALENDAR_URL));
    const provider = await readProvider();
    assert.equal(provider.tokens?.refresh_token, "refresh-dead");
    assert.equal(provider.tokens?.access_token, "expired-access");
  });

  test("concurrent gfetch calls on an expired token perform only one token refresh", async () => {
    await seedExpiredTokens("refresh-shared");
    let tokenCalls = 0;
    const authHeaders: Array<string | null> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return Response.json({
          access_token: "fresh-access",
          refresh_token: "refresh-shared-2",
          expires_in: 3600,
        });
      }
      authHeaders.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({ ok: true });
    };

    const [res1, res2] = await Promise.all([
      gfetch(`${CALENDAR_URL}?a=1`),
      gfetch(`${CALENDAR_URL}?a=2`),
    ]);
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(authHeaders, [
      "Bearer fresh-access",
      "Bearer fresh-access",
    ]);
    const provider = await readProvider();
    assert.equal(provider.tokens?.access_token, "fresh-access");
    assert.equal(provider.tokens?.refresh_token, "refresh-shared-2");
  });

  test("clearProviderConnection during an in-flight refresh rejects with AuthError without resurrecting tokens", async () => {
    await seedExpiredTokens("refresh-logout-race");
    let tokenRequested!: () => void;
    const waitTokenRequested = new Promise<void>((resolve) => {
      tokenRequested = resolve;
    });
    let releaseToken!: (res: Response) => void;
    const tokenResponse = new Promise<Response>((resolve) => {
      releaseToken = resolve;
    });

    globalThis.fetch = async (input) => {
      if (String(input) === TOKEN_URL) {
        tokenRequested();
        return tokenResponse;
      }
      return Response.json({});
    };

    const pending = gfetch(CALENDAR_URL);
    await waitTokenRequested;
    await clearProviderConnection();
    releaseToken(
      Response.json({
        access_token: "resurrected",
        refresh_token: "refresh-logout-race",
        expires_in: 3600,
      }),
    );

    await assert.rejects(() => pending, AuthError);
    assert.equal((await readProvider()).tokens, null);
  });

  test("switching accounts during a failing invalid_grant refresh does not wipe the newer account", async () => {
    await seedExpiredTokens("refresh-old", "acct-old");
    let tokenRequested!: () => void;
    const waitTokenRequested = new Promise<void>((resolve) => {
      tokenRequested = resolve;
    });
    let releaseToken!: (res: Response) => void;
    const tokenResponse = new Promise<Response>((resolve) => {
      releaseToken = resolve;
    });

    globalThis.fetch = async (input) => {
      if (String(input) === TOKEN_URL) {
        tokenRequested();
        return tokenResponse;
      }
      return Response.json({});
    };

    const pending = gfetch(CALENDAR_URL);
    await waitTokenRequested;
    await establishProviderConnection("acct-new", {
      access_token: "new-access",
      refresh_token: "refresh-new",
      expiry: Date.now() + 60_000,
    });
    releaseToken(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );

    await assert.rejects(() => pending, AuthError);
    const provider = await readProvider();
    assert.equal(provider.providerConnectionId, "acct-new");
    assert.equal(provider.tokens?.access_token, "new-access");
  });

  test("hanging Google API request times out cleanly", async () => {
    await seedValidTokens();
    globalThis.fetch = fetchAbortingWithSignal();

    await assert.rejects(
      () => gfetch(CALENDAR_URL, { timeoutMs: 25 }),
      (err: unknown) => err instanceof Error && err.name === "TimeoutError",
    );
  });

  test("hanging OAuth refresh times out cleanly", async () => {
    await seedExpiredTokens("refresh-hang");
    globalThis.fetch = fetchAbortingWithSignal();

    await assert.rejects(
      () => gfetch(CALENDAR_URL, { timeoutMs: 25 }),
      (err: unknown) => err instanceof Error && err.name === "TimeoutError",
    );
  });

  test("caller AbortSignal aborts gfetch immediately without waiting for timeoutMs", async () => {
    await seedValidTokens();
    const controller = new AbortController();
    globalThis.fetch = fetchAbortingWithSignal();

    const pending = gfetch(CALENDAR_URL, {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();

    await assert.rejects(
      () => pending,
      (err: unknown) => err instanceof Error && err.name === "AbortError",
    );
  });

  test("gfetch shares a single in-flight OAuth refresh across separate module graphs and cleans up afterwards", async () => {
    await seedExpiredTokens("refresh-cross-graph");

    vi.resetModules();
    const modA = await import("@/shared/google");
    vi.resetModules();
    const modB = await import("@/shared/google");
    assert.notEqual(modA.gfetch, modB.gfetch);

    let tokenCalls = 0;
    const authHeaders: Array<string | null> = [];
    let tokenRequested!: () => void;
    const waitTokenRequested = new Promise<void>((resolve) => {
      tokenRequested = resolve;
    });
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    let nextAccessToken = "fresh-cross-graph";
    let nextRefreshToken = "refresh-cross-graph-2";

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenCalls += 1;
        tokenRequested();
        await tokenGate;
        return Response.json({
          access_token: nextAccessToken,
          refresh_token: nextRefreshToken,
          expires_in: 3600,
        });
      }
      authHeaders.push(new Headers(init?.headers).get("Authorization"));
      return Response.json({ ok: true });
    };

    const reqA = modA.gfetch(`${CALENDAR_URL}?graph=a`);
    await waitTokenRequested;

    const reqB = modB.gfetch(`${CALENDAR_URL}?graph=b`);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(tokenCalls, 1);

    releaseToken();
    const [resA, resB] = await Promise.all([reqA, reqB]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(authHeaders, [
      "Bearer fresh-cross-graph",
      "Bearer fresh-cross-graph",
    ]);
    const provider = await readProvider();
    assert.equal(provider.tokens?.access_token, "fresh-cross-graph");
    assert.equal(provider.tokens?.refresh_token, "refresh-cross-graph-2");

    await seedExpiredTokens("refresh-cross-graph");
    nextAccessToken = "fresh-cross-graph-next";
    nextRefreshToken = "refresh-cross-graph-3";
    const resC = await modB.gfetch(`${CALENDAR_URL}?graph=c`);
    assert.equal(resC.status, 200);
    assert.equal(tokenCalls, 2);
    assert.equal(authHeaders[2], "Bearer fresh-cross-graph-next");
  });
});
