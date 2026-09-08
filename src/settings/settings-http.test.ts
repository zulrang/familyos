/**
 * HTTP acceptance seam for Settings: per-Display UI scale (#4) and
 * versioned Household Configuration (#5). Isolated data dir; no live Google.
 */

import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, test } from "vitest";

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
  let handleKickUpdate: typeof import("./update-http.ts").handleKickUpdate;

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
    ({ handleKickUpdate } = await import("./update-http.ts"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "ScaleHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
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
      idleDimAfterMs: number;
      idleDimTo: number;
      configVersion: number;
      signedIn: boolean;
      listIds: string[];
      timeZone: string;
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

  test("new Trusted Displays default Idle Dim to 5 minutes and 10%", async () => {
    const a = await getSettings(first.cookie);
    const b = await getSettings(second.cookie);
    assert.equal(a.idleDimAfterMs, 300_000);
    assert.equal(a.idleDimTo, 10);
    assert.equal(b.idleDimAfterMs, 300_000);
    assert.equal(b.idleDimTo, 10);
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

  test("Trusted Displays keep independent Idle Dim across GET reloads", async () => {
    const setA = await patchSettings(first.cookie, {
      idleDimAfterMs: 120_000,
      idleDimTo: 20,
    });
    assert.equal(setA.status, 200);
    const a = (await setA.json()) as {
      idleDimAfterMs: number;
      idleDimTo: number;
    };
    assert.equal(a.idleDimAfterMs, 120_000);
    assert.equal(a.idleDimTo, 20);

    const setB = await patchSettings(second.cookie, {
      idleDimAfterMs: 30_000,
      idleDimTo: 1,
    });
    assert.equal(setB.status, 200);
    const b = (await setB.json()) as {
      idleDimAfterMs: number;
      idleDimTo: number;
    };
    assert.equal(b.idleDimAfterMs, 30_000);
    assert.equal(b.idleDimTo, 1);

    const firstGet = await getSettings(first.cookie);
    const secondGet = await getSettings(second.cookie);
    assert.equal(firstGet.idleDimAfterMs, 120_000);
    assert.equal(firstGet.idleDimTo, 20);
    assert.equal(secondGet.idleDimAfterMs, 30_000);
    assert.equal(secondGet.idleDimTo, 1);
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

  test("changing Idle Dim does not mutate Household Configuration", async () => {
    const before = await readFile(
      path.join(dataRoot, "household.json"),
      "utf8",
    );
    const householdBefore = await readHousehold();
    assert.equal(householdBefore.configVersion, 1);

    const res = await patchSettings(first.cookie, {
      idleDimAfterMs: 600_000,
      idleDimTo: 80,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      idleDimAfterMs: number;
      idleDimTo: number;
      configVersion: number;
    };
    assert.equal(body.idleDimAfterMs, 600_000);
    assert.equal(body.idleDimTo, 80);
    assert.equal(body.configVersion, 1);

    const after = await readFile(path.join(dataRoot, "household.json"), "utf8");
    assert.equal(after, before);
    assert.equal((await getSettings(second.cookie)).idleDimAfterMs, 30_000);
    assert.equal((await getSettings(second.cookie)).configVersion, 1);
  });

  test("unparseable Household fields are rejected without writing", async () => {
    const before = await readHousehold();
    const res = await patchSettings(first.cookie, {
      familyName: 1,
      expectedVersion: before.configVersion,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "invalid body");
    assert.equal((await readHousehold()).familyName, before.familyName);
    assert.equal((await readHousehold()).configVersion, before.configVersion);
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
      idleDimAfterMs: number;
      idleDimTo: number;
      signedIn: boolean;
    };
    assert.equal(body.familyName, "RenamedHousehold");
    assert.equal(body.configVersion, 2);
    assert.equal(body.uiScale, 1.1);
    assert.equal(body.idleDimAfterMs, 600_000);
    assert.equal(body.idleDimTo, 80);
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

  test("invalid Idle Dim values are normalized to the previous values", async () => {
    const res = await patchSettings(first.cookie, {
      idleDimAfterMs: 45_000,
      idleDimTo: 15,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      idleDimAfterMs: number;
      idleDimTo: number;
    };
    assert.equal(body.idleDimAfterMs, 600_000);
    assert.equal(body.idleDimTo, 80);

    const badType = await patchSettings(second.cookie, {
      idleDimAfterMs: "30000",
      idleDimTo: 0,
    });
    assert.equal(badType.status, 200);
    const secondBody = (await badType.json()) as {
      idleDimAfterMs: number;
      idleDimTo: number;
    };
    assert.equal(secondBody.idleDimAfterMs, 30_000);
    assert.equal(secondBody.idleDimTo, 1);
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

  test("GET exposes the Household Time Zone", async () => {
    const body = await getSettings(first.cookie);
    assert.equal(body.timeZone, "America/New_York");
  });

  test("a valid Household Time Zone patch bumps configVersion", async () => {
    const cur = await getSettings(first.cookie);
    const res = await patchSettings(first.cookie, {
      timeZone: "Pacific/Auckland",
      expectedVersion: cur.configVersion,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      timeZone: string;
      configVersion: number;
    };
    assert.equal(body.timeZone, "Pacific/Auckland");
    assert.equal(body.configVersion, cur.configVersion + 1);
    assert.equal(
      (await getSettings(second.cookie)).timeZone,
      "Pacific/Auckland",
    );
  });

  test("an invalid Household Time Zone is rejected without writing", async () => {
    const before = await readHousehold();
    const res = await patchSettings(first.cookie, {
      timeZone: "Not/A_Zone",
      expectedVersion: before.configVersion,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "invalid time zone");
    assert.equal((await readHousehold()).timeZone, before.timeZone);
    assert.equal((await readHousehold()).configVersion, before.configVersion);
  });

  test("duplicate Active Member Colors are rejected without writing", async () => {
    const before = await readHousehold();
    const res = await patchSettings(first.cookie, {
      members: [
        { id: "a", name: "Ada", status: "active", color: "#a9d8d2" },
        { id: "b", name: "Ben", status: "active", color: "#a9d8d2" },
      ],
      expectedVersion: before.configVersion,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "duplicate_active_color");
    assert.deepEqual((await readHousehold()).members, before.members);
    assert.equal((await readHousehold()).configVersion, before.configVersion);
  });

  describe("Household server update", () => {
    const previousScript = process.env.FAMILYOS_MACOS_SERVER;
    let stubDir: string;
    let receipt: string;

    beforeAll(async () => {
      stubDir = await mkdtemp(path.join(tmpdir(), "familyos-update-"));
      receipt = path.join(stubDir, "receipt");
      await writeFile(receipt, "");
    });

    afterEach(async () => {
      await writeFile(receipt, "");
      if (previousScript === undefined) {
        delete process.env.FAMILYOS_MACOS_SERVER;
      } else {
        process.env.FAMILYOS_MACOS_SERVER = previousScript;
      }
    });

    afterAll(async () => {
      if (previousScript === undefined) {
        delete process.env.FAMILYOS_MACOS_SERVER;
      } else {
        process.env.FAMILYOS_MACOS_SERVER = previousScript;
      }
      if (stubDir) await rm(stubDir, { recursive: true, force: true });
    });

    async function stubMacosServer(body: string) {
      const script = path.join(stubDir, "macos-server");
      await writeFile(
        script,
        `#!/bin/bash\nprintf '%s\\n' "$*" >> "${receipt}"\n${body}\n`,
      );
      await chmod(script, 0o755);
      process.env.FAMILYOS_MACOS_SERVER = script;
    }

    test("unpaired clients cannot start an update", async () => {
      await stubMacosServer("exit 0");
      const res = await handleKickUpdate(
        new Request("http://familyos.test/api/settings/update", {
          method: "POST",
        }),
      );
      assert.equal(res.status, 401);
      assert.equal((await readFile(receipt, "utf8")).trim(), "");
    });

    test("a Trusted Display submits kick-update and the job is accepted", async () => {
      await stubMacosServer("exit 0");
      const res = await handleKickUpdate(
        new Request("http://familyos.test/api/settings/update", {
          method: "POST",
          headers: { cookie: first.cookie },
        }),
      );
      assert.equal(res.status, 202);
      const body = (await res.json()) as { ok: boolean };
      assert.equal(body.ok, true);
      const logged = (await readFile(receipt, "utf8")).trim();
      assert.equal(logged, "kick-update");
    });

    test("a kick-update failure is returned without claiming success", async () => {
      await stubMacosServer("exit 1");
      const res = await handleKickUpdate(
        new Request("http://familyos.test/api/settings/update", {
          method: "POST",
          headers: { cookie: first.cookie },
        }),
      );
      assert.equal(res.status, 500);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "Could not start update.");
    });
  });
});
