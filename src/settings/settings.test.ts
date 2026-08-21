/**
 * Household Time Zone store seam (#10). Isolated data dir; no HTTP.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import { isIanaTimeZone } from "@/shared/time";

describe("Household Time Zone store", () => {
  let dataRoot: string;
  let readHousehold: typeof import("@/settings/settings").readHousehold;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let updateHousehold: typeof import("@/settings/settings").updateHousehold;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-tz-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;
    ({ readHousehold, writeHousehold, updateHousehold } = await import(
      "@/settings/settings"
    ));
    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "TzHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      configVersion: 1,
      timeZone: "America/New_York",
    });
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test("missing timeZone normalizes to a valid IANA zone", async () => {
    await writeFile(
      path.join(dataRoot, "household.json"),
      `${JSON.stringify({
        familyName: "TzHousehold",
        members: [],
        calendarId: null,
        calendarTimeZone: null,
        listIds: [],
        configVersion: 1,
      })}\n`,
    );
    const cfg = await readHousehold();
    assert.equal(isIanaTimeZone(cfg.timeZone), true);
  });

  test("a valid IANA time zone persists and bumps configVersion", async () => {
    const before = await readHousehold();
    const result = await updateHousehold(before.configVersion, {
      timeZone: "Pacific/Auckland",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.timeZone, "Pacific/Auckland");
    assert.equal(result.config.configVersion, before.configVersion + 1);
    assert.equal((await readHousehold()).timeZone, "Pacific/Auckland");
  });

  test("an invalid time zone leaves Household Configuration unchanged", async () => {
    const before = await readHousehold();
    const fileBefore = await readFile(
      path.join(dataRoot, "household.json"),
      "utf8",
    );
    const result = await updateHousehold(before.configVersion, {
      timeZone: "Not/A_Zone",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "timeZone");
    assert.equal(result.config.timeZone, before.timeZone);
    assert.equal(result.config.configVersion, before.configVersion);
    assert.equal((await readHousehold()).timeZone, before.timeZone);
    assert.equal(
      await readFile(path.join(dataRoot, "household.json"), "utf8"),
      fileBefore,
    );
  });

  test("a corrupt stored time zone cannot be read back as-is", async () => {
    const cur = await readHousehold();
    await writeFile(
      path.join(dataRoot, "household.json"),
      `${JSON.stringify({ ...cur, timeZone: "Not/A_Zone" })}\n`,
    );
    const cfg = await readHousehold();
    assert.notEqual(cfg.timeZone, "Not/A_Zone");
    assert.equal(isIanaTimeZone(cfg.timeZone), true);
  });
});
