import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, test } from "vitest";
import { AuthError } from "@/shared/auth-error";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

describe("Google refresh grant", () => {
  let dataRoot: string;
  let gfetch: typeof import("@/shared/google").gfetch;
  let readProvider: typeof import("@/shared/provider").readProvider;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  const origFetch = globalThis.fetch;

  async function seedExpiredTokens(): Promise<void> {
    await writeProvider({
      tokens: {
        access_token: "expired-access",
        refresh_token: "refresh-dead",
        expiry: Date.now() - 1,
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
    ({ readProvider, writeProvider } = await import("@/shared/provider"));

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
});
