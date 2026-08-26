import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import { googleRedirectUri, publicOrigin } from "./google-env";

describe("OAuth redirect origin", () => {
  const prev = process.env.GOOGLE_REDIRECT_URI;

  afterEach(() => {
    if (prev === undefined) delete process.env.GOOGLE_REDIRECT_URI;
    else process.env.GOOGLE_REDIRECT_URI = prev;
  });

  test("uses the Host header when the request URL is localhost", () => {
    process.env.GOOGLE_REDIRECT_URI =
      "http://localhost:3000/api/auth/callback/google";
    const request = new Request("http://localhost:3000/api/auth/google", {
      headers: { host: "192.168.1.20:3000" },
    });
    assert.equal(publicOrigin(request), "http://192.168.1.20:3000");
    assert.equal(
      googleRedirectUri(request),
      "http://192.168.1.20:3000/api/auth/callback/google",
    );
  });
});
