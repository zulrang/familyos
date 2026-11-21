import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";

describe("Display pairing store concurrency and permissions", () => {
  let dataRoot: string;
  let createPairingCode: typeof import("./pairing").createPairingCode;
  let emitStartupPairingCode: typeof import("./pairing").emitStartupPairingCode;
  let listTrustedDisplays: typeof import("./pairing").listTrustedDisplays;
  let pairWithCode: typeof import("./pairing").pairWithCode;
  let resolveTrustedDisplay: typeof import("./pairing").resolveTrustedDisplay;
  let setDisplayIdleDim: typeof import("./pairing").setDisplayIdleDim;
  let setDisplayUiScale: typeof import("./pairing").setDisplayUiScale;
  let DISPLAY_COOKIE: typeof import("./pairing").DISPLAY_COOKIE;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-pairing-unit-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;
    await mkdir(dataRoot, { recursive: true });

    ({
      createPairingCode,
      emitStartupPairingCode,
      listTrustedDisplays,
      pairWithCode,
      resolveTrustedDisplay,
      setDisplayIdleDim,
      setDisplayUiScale,
      DISPLAY_COOKIE,
    } = await import("./pairing"));
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test("displays.json is written with mode 0o600 and validates tokens", async () => {
    const code = await emitStartupPairingCode();
    assert.ok(code);
    const paired = await pairWithCode(code);
    assert.equal(paired.ok, true);
    if (!paired.ok) return;

    const info = await stat(path.join(dataRoot, "displays.json"));
    assert.equal(info.mode & 0o777, 0o600);

    const trusted = await resolveTrustedDisplay(
      `${DISPLAY_COOKIE}=${paired.token}`,
    );
    assert.equal(trusted?.id, paired.display.id);
    assert.equal(
      await resolveTrustedDisplay(`${DISPLAY_COOKIE}=${paired.display.id}.bad`),
      null,
    );
  });

  test("concurrent pairWithCode calls with the same single-use code succeed exactly once", async () => {
    const { code } = await createPairingCode();
    const beforeCount = (await listTrustedDisplays()).length;

    const results = await Promise.all([
      pairWithCode(code),
      pairWithCode(code),
      pairWithCode(code),
      pairWithCode(code),
    ]);

    const okResults = results.filter((r) => r.ok);
    const reusedResults = results.filter((r) => !r.ok && r.reason === "reused");
    assert.equal(okResults.length, 1);
    assert.equal(reusedResults.length, 3);
    assert.equal((await listTrustedDisplays()).length, beforeCount + 1);
  });

  test("concurrent setDisplayUiScale and setDisplayIdleDim preserve both updates", async () => {
    const { code } = await createPairingCode();
    const paired = await pairWithCode(code);
    assert.equal(paired.ok, true);
    if (!paired.ok) return;

    const [scaleOk, dimOk] = await Promise.all([
      setDisplayUiScale(paired.display.id, 1.25),
      setDisplayIdleDim(paired.display.id, 60_000, 30),
    ]);
    assert.equal(scaleOk, true);
    assert.equal(dimOk, true);

    const trusted = await resolveTrustedDisplay(
      `${DISPLAY_COOKIE}=${paired.token}`,
    );
    assert.equal(trusted?.uiScale, 1.25);
    assert.equal(trusted?.idleDimAfterMs, 60_000);
    assert.equal(trusted?.idleDimTo, 30);
  });
});
