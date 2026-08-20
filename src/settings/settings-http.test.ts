/**
 * HTTP acceptance seam for Settings: per-Display UI scale (#4) and
 * versioned Household Configuration (#5). Isolated data dir; no live Google.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";

describe("Household Configuration HTTP", () => {
  let dataRoot: string;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let readHousehold: typeof import("@/settings/settings").readHousehold;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let createPairingCode: typeof import("@/shared/pairing").createPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;
  let handleGetSettings: typeof import("./settings-http.ts").handleGetSettings;
  let handlePatchSettings: typeof import("./settings-http.ts").handlePatchSettings;

  let first: { cookie: string; displayId: string };
  let second: { cookie: string; displayId: string };

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-settings-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({ writeHousehold, readHousehold } = await import("@/settings/settings"));
    ({ writeProvider } = await import("@/shared/provider"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE, createPairingCode } =
      await import("@/shared/pairing"));
    ({ handlePair } = await import("@/displays/pairing-http"));
    ({ handleGetSettings, handlePatchSettings } = await import(
      "./settings-http.ts"
    ));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "ScaleHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      configVersion: 1,
    });
    await writeProvider({
      tokens: {
        access_token: "secret-access",
        refresh_token: "secret-refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: "secret-oauth-state",
      providerConnectionId: "conn-secret",
    });

    function cookieFrom(res: Response): string | null {
      const raw = res.headers.getSetCookie?.() ?? [];
      if (raw.length) {
        const line = raw.find((c) => c.startsWith(`${DISPLAY_COOKIE}=`));
        return line?.split(";")[0] ?? null;
      }
      const single = res.headers.get("set-cookie");
      if (!single) return null;
      return single.split(";")[0] ?? null;
    }

    async function pairWithCode(code: string): Promise<{
      cookie: string;
      displayId: string;
    }> {
      const res = await handlePair(
        new Request("http://familyos.test/api/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        }),
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { displayId: string };
      const cookie = cookieFrom(res);
      assert.ok(cookie);
      return { cookie, displayId: body.displayId };
    }

    const startupCode = await emitStartupPairingCode();
    assert.ok(startupCode);
    first = await pairWithCode(startupCode);
    const { code: secondCode } = await createPairingCode();
    second = await pairWithCode(secondCode);
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function getSettings(cookie: string) {
    const res = await handleGetSettings(
      new Request("http://familyos.test/api/settings", {
        headers: { cookie },
      }),
    );
    assert.equal(res.status, 200);
    return (await res.json()) as {
      familyName: string;
      uiScale: number;
      configVersion: number;
      signedIn: boolean;
      listIds: string[];
    };
  }

  async function patchSettings(cookie: string, body: Record<string, unknown>) {
    return handlePatchSettings(
      new Request("http://familyos.test/api/settings", {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  test("GET exposes Household Configuration version without provider secrets", async () => {
    const res = await handleGetSettings(
      new Request("http://familyos.test/api/settings", {
        headers: { cookie: first.cookie },
      }),
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes("secret-access"), false);
    assert.equal(text.includes("secret-refresh"), false);
    assert.equal(text.includes("secret-oauth-state"), false);
    assert.equal(text.includes("conn-secret"), false);
    assert.equal(text.includes("tokens"), false);
    assert.equal(text.includes("oauthState"), false);
    assert.equal(text.includes("providerConnectionId"), false);
    const body = JSON.parse(text) as {
      configVersion: number;
      signedIn: boolean;
      familyName: string;
    };
    assert.equal(body.configVersion, 1);
    assert.equal(body.signedIn, true);
    assert.equal(body.familyName, "ScaleHousehold");
  });

  test("new Trusted Displays default to 100% UI scale", async () => {
    const a = await getSettings(first.cookie);
    const b = await getSettings(second.cookie);
    assert.equal(a.uiScale, 1);
    assert.equal(b.uiScale, 1);
    assert.equal(a.familyName, "ScaleHousehold");
    assert.equal(a.configVersion, 1);
  });

  test("Trusted Displays keep independent UI scales across GET reloads", async () => {
    const setA = await patchSettings(first.cookie, { uiScale: 1.5 });
    assert.equal(setA.status, 200);
    assert.equal(((await setA.json()) as { uiScale: number }).uiScale, 1.5);

    const setB = await patchSettings(second.cookie, { uiScale: 1.25 });
    assert.equal(setB.status, 200);
    assert.equal(((await setB.json()) as { uiScale: number }).uiScale, 1.25);

    assert.equal((await getSettings(first.cookie)).uiScale, 1.5);
    assert.equal((await getSettings(second.cookie)).uiScale, 1.25);
  });

  test("changing UI scale does not mutate Household Configuration", async () => {
    const before = await readFile(
      path.join(dataRoot, "household.json"),
      "utf8",
    );
    const householdBefore = await readHousehold();
    assert.equal(householdBefore.configVersion, 1);

    const res = await patchSettings(first.cookie, { uiScale: 1.1 });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { uiScale: number }).uiScale, 1.1);

    const after = await readFile(path.join(dataRoot, "household.json"), "utf8");
    assert.equal(after, before);
    assert.equal((await getSettings(second.cookie)).uiScale, 1.25);
    assert.equal((await getSettings(second.cookie)).configVersion, 1);
  });

  test("Household field patch with matching expectedVersion bumps configVersion", async () => {
    const res = await patchSettings(first.cookie, {
      familyName: "RenamedHousehold",
      expectedVersion: 1,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      familyName: string;
      uiScale: number;
      configVersion: number;
    };
    assert.equal(body.familyName, "RenamedHousehold");
    assert.equal(body.uiScale, 1.1);
    assert.equal(body.configVersion, 2);
    assert.equal((await getSettings(second.cookie)).uiScale, 1.25);
    assert.equal(
      (await getSettings(second.cookie)).familyName,
      "RenamedHousehold",
    );
    assert.equal((await getSettings(second.cookie)).configVersion, 2);
    assert.equal((await readHousehold()).configVersion, 2);
  });

  test("stale expectedVersion rejects Household mutation and returns current public state", async () => {
    const before = await readHousehold();
    const res = await patchSettings(first.cookie, {
      familyName: "ShouldNotWin",
      expectedVersion: 1,
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      familyName: string;
      configVersion: number;
      uiScale: number;
      signedIn: boolean;
    };
    assert.equal(body.familyName, "RenamedHousehold");
    assert.equal(body.configVersion, 2);
    assert.equal(body.uiScale, 1.1);
    assert.equal(body.signedIn, true);
    assert.equal((await readHousehold()).familyName, before.familyName);
    assert.equal((await readHousehold()).configVersion, 2);
  });

  test("missing expectedVersion on Household mutation is a conflict", async () => {
    const res = await patchSettings(first.cookie, {
      familyName: "AlsoShouldNotWin",
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      familyName: string;
      configVersion: number;
    };
    assert.equal(body.familyName, "RenamedHousehold");
    assert.equal(body.configVersion, 2);
    assert.equal((await readHousehold()).familyName, "RenamedHousehold");
  });

  test("invalid UI scale values are normalized to the previous scale", async () => {
    const res = await patchSettings(first.cookie, { uiScale: 9 });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { uiScale: number }).uiScale, 1.1);

    const badType = await patchSettings(second.cookie, { uiScale: "1.5" });
    assert.equal(badType.status, 200);
    assert.equal(((await badType.json()) as { uiScale: number }).uiScale, 1.25);
  });

  test("GET exposes empty Household List selection", async () => {
    const body = await getSettings(first.cookie);
    assert.deepEqual(body.listIds, []);
  });

  test("select and unselect Household Lists bumps configVersion", async () => {
    const cur = await getSettings(first.cookie);
    const select = await patchSettings(first.cookie, {
      listIds: ["tl-groceries", "tl-chores"],
      expectedVersion: cur.configVersion,
    });
    assert.equal(select.status, 200);
    const selected = (await select.json()) as {
      listIds: string[];
      configVersion: number;
    };
    assert.deepEqual(selected.listIds, ["tl-groceries", "tl-chores"]);
    assert.equal(selected.configVersion, cur.configVersion + 1);

    const unselect = await patchSettings(first.cookie, {
      listIds: ["tl-groceries"],
      expectedVersion: selected.configVersion,
    });
    assert.equal(unselect.status, 200);
    const after = (await unselect.json()) as {
      listIds: string[];
      configVersion: number;
    };
    assert.deepEqual(after.listIds, ["tl-groceries"]);
    assert.equal(after.configVersion, selected.configVersion + 1);
    assert.deepEqual((await readHousehold()).listIds, ["tl-groceries"]);
  });

  test("stale listIds mutation rejects and returns current selection", async () => {
    const before = await readHousehold();
    const res = await patchSettings(first.cookie, {
      listIds: ["tl-should-not-win"],
      expectedVersion: 1,
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as {
      listIds: string[];
      configVersion: number;
    };
    assert.deepEqual(body.listIds, before.listIds);
    assert.equal(body.configVersion, before.configVersion);
    assert.deepEqual((await readHousehold()).listIds, before.listIds);
  });

  test("duplicate and blank listIds are normalized", async () => {
    const cur = await readHousehold();
    const res = await patchSettings(first.cookie, {
      listIds: ["tl-a", "tl-a", "", "  ", "tl-b"],
      expectedVersion: cur.configVersion,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { listIds: string[] };
    assert.deepEqual(body.listIds, ["tl-a", "tl-b"]);
  });
});
