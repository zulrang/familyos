import { describe, expect, test } from "vitest";
import {
  legacyBountySchedule,
  legacyIntervalStart,
} from "./legacy-bounty-migration";
import type { DayOfMonth, LegacyTaskDefinition, LocalDate } from "./types";

function definition(
  recurrence: LegacyTaskDefinition["recurrence"],
  retiredAt: LocalDate | null = null,
): LegacyTaskDefinition {
  return {
    id: "legacy-open" as LegacyTaskDefinition["id"],
    lineage: "legacy-lineage" as LegacyTaskDefinition["lineage"],
    title: "Legacy work",
    type: "chore",
    recurrence,
    assignment: { kind: "open" },
    time: null,
    stars: 3,
    retiredAt,
  };
}

describe("legacy Bounty calendar compatibility", () => {
  test("normalizes duplicated weekdays and preserves arbitrary accepted windows", () => {
    const source = definition({
      kind: "weekly",
      days: ["fri", "mon", "fri"],
    });

    const schedule = legacyBountySchedule(source, "2026-09-17" as LocalDate, [
      "2026-08-18" as LocalDate,
    ]);

    expect(schedule).toEqual({
      kind: "recurring",
      startsOn: "2026-08-17",
      cadence: { kind: "weekly", days: ["mon", "fri"] },
    });
    if (schedule.kind !== "recurring") return;
    expect(
      legacyIntervalStart(schedule.cadence, "2026-08-18" as LocalDate),
    ).toBe("2026-08-17");
  });

  test("an active schedule preserves its interval at migration", () => {
    expect(
      legacyBountySchedule(
        definition({
          kind: "monthly",
          day: 12 as DayOfMonth,
        }),
        "2026-09-17" as LocalDate,
        [],
      ),
    ).toEqual({
      kind: "recurring",
      startsOn: "2026-09-12",
      cadence: { kind: "monthly", day: 12 },
    });
  });

  test("a retired schedule anchors at retirement and includes older represented work", () => {
    expect(
      legacyBountySchedule(
        definition(
          { kind: "weekly", days: ["sun", "mon"] },
          "2026-09-10" as LocalDate,
        ),
        "2026-09-17" as LocalDate,
        ["2026-08-30" as LocalDate],
      ),
    ).toEqual({
      kind: "recurring",
      startsOn: "2026-08-30",
      cadence: { kind: "weekly", days: ["mon", "sun"] },
    });
  });

  test("Once work drops its legacy date", () => {
    expect(
      legacyBountySchedule(
        definition({ kind: "once", date: "2026-01-01" as LocalDate }),
        "2026-09-17" as LocalDate,
        ["2025-12-31" as LocalDate],
      ),
    ).toEqual({ kind: "once" });
  });
});
