/**
 * Google's callback must use the Host the Display actually loaded, not
 * localhost / GOOGLE_REDIRECT_URI. Pairing cookies are origin-scoped.
 * CSRF is oauthState, not the Display cookie (Google's return may omit it).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, test } from "vitest";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const STATE = "pending-oauth-state";

describe("Google OAuth callback HTTP", () => {
  let dataRoot: string;
  let GET: typeof import("./route").GET;
  let readProvider: typeof import("@/shared/provider").readProvider;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-oauth-cb-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";

    ({ GET } = await import("./route"));
    ({ readProvider, writeProvider } = await import("@/shared/provider"));
    await mkdir(dataRoot, { recursive: true });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function seedPendingState(): Promise<void> {
    await writeProvider({
      tokens: null,
      oauthState: STATE,
      providerConnectionId: null,
    });
  }

  test("exchanges the code without a Display cookie when state matches", async () => {
    await seedPendingState();
    let tokenBody = "";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      if (url === USERINFO_URL) {
        return new Response(JSON.stringify({ sub: "acct-google" }), {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    };

    const res = await GET(
      new NextRequest(
        `http://familyos.test/api/auth/callback/google?code=auth-code&state=${STATE}`,
      ),
    );

    assert.notEqual(res.status, 401);
    assert.equal(res.headers.get("location"), "http://familyos.test/settings");
    assert.ok(tokenBody.includes("code=auth-code"));
    const provider = await readProvider();
    assert.equal(provider.tokens?.access_token, "new-access");
    assert.equal(provider.providerConnectionId, "acct-google");
    assert.equal(provider.oauthState, null);
  });

  test("token exchange uses Host, not localhost, when they differ", async () => {
    process.env.GOOGLE_REDIRECT_URI =
      "http://localhost:3000/api/auth/callback/google";
    await seedPendingState();
    let tokenBody = "";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === TOKEN_URL) {
        tokenBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      if (url === USERINFO_URL) {
        return new Response(JSON.stringify({ sub: "acct-google" }), {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 500 });
    };

    const res = await GET(
      new NextRequest(
        `http://localhost:3000/api/auth/callback/google?code=auth-code&state=${STATE}`,
        { headers: { host: "192.168.1.20:3000" } },
      ),
    );

    assert.notEqual(res.status, 401);
    assert.equal(
      res.headers.get("location"),
      "http://192.168.1.20:3000/settings",
    );
    assert.ok(tokenBody.includes("192.168.1.20%3A3000"));
    assert.equal(tokenBody.includes("localhost"), false);
  });
});
