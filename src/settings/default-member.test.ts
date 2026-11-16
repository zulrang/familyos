import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readHousehold, updateHousehold } from "./settings";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "familyos-default-member-"));
  vi.stubEnv("FAMILYOS_DATA_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

test("a household saved before External Task Sources has no default member", async () => {
  await writeFile(
    path.join(dir, "household.json"),
    JSON.stringify({
      familyName: "Family",
      members: [{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 3,
    }),
  );
  expect((await readHousehold()).externalTaskDefaultMember).toBeNull();
});

test("the default member persists by ID and survives unrelated updates", async () => {
  await readHousehold();
  const saved = await updateHousehold(1, { externalTaskDefaultMember: "dad" });
  expect(saved.ok).toBe(true);
  const renamed = await updateHousehold(2, { familyName: "Collins" });
  expect(renamed.ok && renamed.config.externalTaskDefaultMember).toBe("dad");
  const stored = JSON.parse(
    await readFile(path.join(dir, "household.json"), "utf8"),
  );
  expect(stored.externalTaskDefaultMember).toBe("dad");
});
