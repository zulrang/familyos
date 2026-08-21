import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  addZonedDays,
  fallbackTimeZone,
  formatClock,
  isIanaTimeZone,
  msToZonedDate,
  msToZonedTime,
  parseTimeZone,
  startOfZonedDay,
  zonedDateTimeToMs,
  zonedDayOfMonth,
} from "@/shared/time";

describe("Household Time Zone", () => {
  test("accepts IANA identifiers and rejects invalid zones", () => {
    assert.equal(isIanaTimeZone("America/New_York"), true);
    assert.equal(isIanaTimeZone("Pacific/Auckland"), true);
    assert.equal(isIanaTimeZone("UTC"), true);
    assert.equal(isIanaTimeZone("Not/A_Zone"), false);
    assert.equal(isIanaTimeZone("EST"), false);
    assert.equal(isIanaTimeZone("GMT"), false);
    assert.equal(isIanaTimeZone(""), false);
    assert.equal(isIanaTimeZone(1), false);

    assert.equal(parseTimeZone("America/New_York", "UTC"), "America/New_York");
    assert.equal(parseTimeZone("Not/A_Zone", "UTC"), "UTC");
    assert.equal(parseTimeZone("", "Pacific/Auckland"), "Pacific/Auckland");
    assert.equal(parseTimeZone(undefined, "UTC"), "UTC");
    assert.equal(isIanaTimeZone(fallbackTimeZone()), true);
    assert.equal(
      fallbackTimeZone(),
      parseTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC"),
    );
  });

  test("clocks the same instant in the given Household Time Zone", () => {
    const instant = new Date("2026-08-19T19:50:00.000Z");
    assert.equal(formatClock(instant, "America/New_York"), "3:50 PM");
    assert.equal(formatClock(instant, "Asia/Tokyo"), "4:50 AM");
  });

  test("round-trips timed wall clocks in the Household Time Zone", () => {
    const ny = zonedDateTimeToMs("2026-08-19", "15:50", "America/New_York");
    assert.equal(ny, Date.parse("2026-08-19T19:50:00.000Z"));
    assert.equal(msToZonedDate(ny, "America/New_York"), "2026-08-19");
    assert.equal(msToZonedTime(ny, "America/New_York"), "15:50");
    assert.equal(msToZonedDate(ny, "Asia/Tokyo"), "2026-08-20");
    assert.equal(msToZonedTime(ny, "Asia/Tokyo"), "04:50");

    const winter = zonedDateTimeToMs("2026-01-15", "15:50", "America/New_York");
    assert.equal(winter, Date.parse("2026-01-15T20:50:00.000Z"));
  });

  test("day bounds follow civil dates across daylight-saving transitions", () => {
    const spring = startOfZonedDay(
      new Date("2026-03-08T17:00:00.000Z"),
      "America/New_York",
    );
    const nextSpring = addZonedDays(spring, 1, "America/New_York");
    assert.equal(spring.toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(nextSpring.toISOString(), "2026-03-09T04:00:00.000Z");
    assert.equal(zonedDayOfMonth(spring, "America/New_York"), 8);
    assert.equal(zonedDayOfMonth(nextSpring, "America/New_York"), 9);

    const fall = startOfZonedDay(
      new Date("2026-11-01T17:00:00.000Z"),
      "America/New_York",
    );
    const nextFall = addZonedDays(fall, 1, "America/New_York");
    assert.equal(fall.toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(nextFall.toISOString(), "2026-11-02T05:00:00.000Z");
  });
});
