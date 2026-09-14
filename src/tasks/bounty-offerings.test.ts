import { expect, test } from "vitest";
import { belongsToOfferingInterval, sameOfferingKey } from "./bounty-offerings";
import { type LegacyOfferingKey, parseLocalDate, parseTaskId } from "./types";

test("legacy occurrences keep distinct identities while sharing a canonical interval", () => {
  const definition = parseTaskId("legacy-weekly");
  const intervalStart = parseLocalDate("2026-09-14");
  const monday = parseLocalDate("2026-09-14");
  const tuesday = parseLocalDate("2026-09-15");
  if (!definition || !intervalStart || !monday || !tuesday)
    throw new Error("invalid test dates");
  const first: LegacyOfferingKey = {
    kind: "legacy",
    definition,
    sourceWindow: monday,
    intervalStart,
  };
  const second: LegacyOfferingKey = {
    kind: "legacy",
    definition,
    sourceWindow: tuesday,
    intervalStart,
  };
  const canonical = { kind: "recurring" as const, definition, intervalStart };

  expect(sameOfferingKey(first, second)).toBe(false);
  expect(belongsToOfferingInterval(first, canonical)).toBe(true);
  expect(belongsToOfferingInterval(second, canonical)).toBe(true);
});
