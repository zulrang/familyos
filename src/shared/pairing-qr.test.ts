import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  formatStartupPairingAnnouncement,
  pairingCodeFromSearch,
  pairingUrl,
} from "./pairing-qr";

describe("pairing QR payload", () => {
  test("encodes only the Display origin and the short-lived code", () => {
    const url = new URL(pairingUrl("http://192.168.1.20:3000", "ABC234"));
    assert.equal(url.origin, "http://192.168.1.20:3000");
    assert.equal(url.pathname, "/");
    assert.deepEqual([...url.searchParams.keys()], ["code"]);
    assert.equal(url.searchParams.get("code"), "ABC234");
    const href = url.href;
    assert.equal(href.includes("credential"), false);
    assert.equal(href.includes("token"), false);
    assert.equal(href.includes("SecretHousehold"), false);
    assert.equal(href.includes("fos_display"), false);
  });

  test("extracts the pairing code from a scanned URL search string", () => {
    assert.equal(pairingCodeFromSearch("?code=abc234"), "ABC234");
    assert.equal(
      pairingCodeFromSearch("?utm=1&code=K7MNPQ&other=ignore"),
      "K7MNPQ",
    );
    assert.equal(pairingCodeFromSearch(""), null);
    assert.equal(pairingCodeFromSearch("?other=ABC234"), null);
    assert.equal(pairingCodeFromSearch("?code="), null);
  });

  test("startup announcement names the typed code and the same scan URL", () => {
    const text = formatStartupPairingAnnouncement(
      "ABC234",
      "http://192.168.1.20:3000",
      10,
    );
    assert.match(text, /FamilyOS pairing code: ABC234/);
    assert.match(text, /expires in 10 minutes/);
    assert.equal(
      text.includes(pairingUrl("http://192.168.1.20:3000", "ABC234")),
      true,
    );
    assert.equal(text.includes("credential"), false);
    assert.equal(text.includes("token"), false);
  });
});
