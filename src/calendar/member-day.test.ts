import { describe, expect, test } from "vitest";
import { memberDayEvents, memberDayTime } from "./member-day";
import type { CalEvent } from "./types";

const date = new Date("2026-09-29T16:00:00Z");
const zone = "America/New_York";

function event(
  id: string,
  start: string,
  end: string,
  participants: string[],
  allDay = false,
): CalEvent {
  return {
    id,
    title: id,
    startMs: Date.parse(start),
    endMs: Date.parse(end),
    participantIds: participants,
    allDay,
    expectedVersion: "v1",
  };
}

describe("member day events", () => {
  test("includes every overlapping all-day and timed event for the member and household, in day order", () => {
    const events = [
      event("next day", "2026-09-30T04:00:00Z", "2026-09-30T05:00:00Z", [
        "dad",
      ]),
      event("other member", "2026-09-29T14:00:00Z", "2026-09-29T15:00:00Z", [
        "ellie",
      ]),
      event("afternoon", "2026-09-29T19:00:00Z", "2026-09-29T20:00:00Z", [
        "dad",
      ]),
      event("overnight", "2026-09-29T02:00:00Z", "2026-09-29T06:00:00Z", [
        "dad",
      ]),
      event("household", "2026-09-29T13:00:00Z", "2026-09-29T14:00:00Z", []),
      event(
        "all day",
        "2026-09-29T04:00:00Z",
        "2026-09-30T04:00:00Z",
        ["dad"],
        true,
      ),
      event(
        "spans days",
        "2026-09-28T04:00:00Z",
        "2026-10-01T04:00:00Z",
        ["dad"],
        true,
      ),
    ];
    expect(
      memberDayEvents(events, "dad", date, zone).map((row) => row.id),
    ).toEqual(["spans days", "all day", "overnight", "household", "afternoon"]);
    expect(
      memberDayEvents(events, "ellie", date, zone).map((row) => row.id),
    ).toEqual(["household", "other member"]);
  });

  test("labels all-day and overnight events without hiding their dates", () => {
    expect(
      memberDayTime(
        event("day", "2026-09-29T04:00:00Z", "2026-09-30T04:00:00Z", [], true),
        zone,
      ),
    ).toBe("All day");
    expect(
      memberDayTime(
        event("night", "2026-09-29T02:00:00Z", "2026-09-29T06:00:00Z", []),
        zone,
      ),
    ).toMatch(/Mon, Sep 28.*Tue, Sep 29/);
  });
});
