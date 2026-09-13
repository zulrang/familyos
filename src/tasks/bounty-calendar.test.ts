import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { msToZonedDate } from "@/shared/time";
import {
  currentBountyInterval,
  parseRecurringBountySchedule,
  type RecurringBountySchedule,
} from "./bounty-calendar";
import { parseLocalDate } from "./types";

function schedule(raw: unknown): RecurringBountySchedule {
  const parsed = parseRecurringBountySchedule(raw);
  assert.ok(parsed);
  return parsed;
}

function localDate(raw: string) {
  const parsed = parseLocalDate(raw);
  assert.ok(parsed);
  return parsed;
}

describe("recurring Bounty schedule parsing", () => {
  test("constructs daily, distinct-weekday, and monthly schedules", () => {
    assert.deepEqual(
      schedule({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "daily" },
      }),
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "daily" },
      },
    );
    assert.deepEqual(
      schedule({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["sun", "mon"] },
      }),
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["sun", "mon"] },
      },
    );
    assert.deepEqual(
      schedule({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "monthly", day: 28 },
      }),
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "monthly", day: 28 },
      },
    );
  });

  test("rejects missing, duplicate, out-of-range, and unknown calendar fields", () => {
    const invalid = [
      { kind: "recurring", cadence: { kind: "daily" } },
      {
        kind: "recurring",
        startsOn: "2026-02-29",
        cadence: { kind: "daily" },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: [] },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["mon", "mon"] },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["monday"] },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "monthly", day: 29 },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "monthly", day: 0 },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "daily", extra: true },
      },
      {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "daily" },
        time: "09:00",
      },
    ];
    for (const raw of invalid) {
      assert.equal(parseRecurringBountySchedule(raw), null);
    }
  });
});

describe("recurring Bounty calendar intervals", () => {
  test("daily intervals begin on the start date and advance without backlog", () => {
    const recurrence = schedule({
      kind: "recurring",
      startsOn: "2026-09-10",
      cadence: { kind: "daily" },
    });
    assert.equal(
      currentBountyInterval(recurrence, localDate("2026-09-09")),
      null,
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-10")),
      { start: "2026-09-10", next: "2026-09-11" },
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-14")),
      { start: "2026-09-14", next: "2026-09-15" },
    );
  });

  test("each selected weekday starts an interval ending at the next selection", () => {
    const recurrence = schedule({
      kind: "recurring",
      startsOn: "2026-09-13",
      cadence: { kind: "weekly", days: ["sun", "mon"] },
    });
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-13")),
      { start: "2026-09-13", next: "2026-09-14" },
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-14")),
      { start: "2026-09-14", next: "2026-09-20" },
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-19")),
      { start: "2026-09-14", next: "2026-09-20" },
    );
  });

  test("a single selected weekday keeps the interval open for seven days", () => {
    const recurrence = schedule({
      kind: "recurring",
      startsOn: "2026-09-14",
      cadence: { kind: "weekly", days: ["mon"] },
    });
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-20")),
      { start: "2026-09-14", next: "2026-09-21" },
    );
  });

  test("weekly work waits for the first matching date on or after its start", () => {
    const recurrence = schedule({
      kind: "recurring",
      startsOn: "2026-09-15",
      cadence: { kind: "weekly", days: ["mon", "fri"] },
    });
    assert.equal(
      currentBountyInterval(recurrence, localDate("2026-09-17")),
      null,
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2026-09-18")),
      { start: "2026-09-18", next: "2026-09-21" },
    );
  });

  test("monthly intervals honor days 1 through 28 across month and year bounds", () => {
    const recurrence = schedule({
      kind: "recurring",
      startsOn: "2026-12-29",
      cadence: { kind: "monthly", day: 28 },
    });
    assert.equal(
      currentBountyInterval(recurrence, localDate("2027-01-27")),
      null,
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2027-01-28")),
      { start: "2027-01-28", next: "2027-02-28" },
    );
    assert.deepEqual(
      currentBountyInterval(recurrence, localDate("2027-03-12")),
      { start: "2027-02-28", next: "2027-03-28" },
    );
  });

  test("Household Time Zone dates roll intervals at local midnight across DST", () => {
    const recurrence = schedule({
      kind: "recurring",
      startsOn: "2026-03-08",
      cadence: { kind: "weekly", days: ["sun", "mon"] },
    });
    const zone = "America/New_York";
    const beforeMidnight = localDate(
      msToZonedDate(Date.parse("2026-03-09T03:59:59Z"), zone),
    );
    const atMidnight = localDate(
      msToZonedDate(Date.parse("2026-03-09T04:00:00Z"), zone),
    );
    assert.deepEqual(currentBountyInterval(recurrence, beforeMidnight), {
      start: "2026-03-08",
      next: "2026-03-09",
    });
    assert.deepEqual(currentBountyInterval(recurrence, atMidnight), {
      start: "2026-03-09",
      next: "2026-03-15",
    });

    const fallSchedule = schedule({
      kind: "recurring",
      startsOn: "2026-11-01",
      cadence: { kind: "daily" },
    });
    const beforeFallMidnight = localDate(
      msToZonedDate(Date.parse("2026-11-02T04:59:59Z"), zone),
    );
    const atFallMidnight = localDate(
      msToZonedDate(Date.parse("2026-11-02T05:00:00Z"), zone),
    );
    assert.deepEqual(currentBountyInterval(fallSchedule, beforeFallMidnight), {
      start: "2026-11-01",
      next: "2026-11-02",
    });
    assert.deepEqual(currentBountyInterval(fallSchedule, atFallMidnight), {
      start: "2026-11-02",
      next: "2026-11-03",
    });
  });
});
