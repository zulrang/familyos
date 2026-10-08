import { describe, expect, test } from "vitest";
import type { CalEvent } from "@/calendar/types";
import type { ActiveMember } from "@/members/members";
import {
  allDayEvents,
  dayLanes,
  dayRange,
  eventBox,
  eventOwners,
  hourAt,
  hourHeight,
  memberDayLane,
  nowOffset,
} from "./today";

const ZONE = "America/New_York";
const DAY = new Date("2026-10-08T16:00:00.000Z"); // Thu Oct 8, noon EDT

const dad: ActiveMember = {
  id: "dad",
  name: "Dad",
  status: "active",
  color: "#3f9c92",
};
const ellie: ActiveMember = {
  id: "ellie",
  name: "Ellie",
  status: "active",
  color: "#9b7fc7",
};
const members = [dad, ellie];

/** Local wall-clock hours on Oct 8 (EDT is UTC-4). */
function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 9, 8, hour + 4, minute);
}

function event(
  id: string,
  startHour: number,
  endHour: number,
  participantIds: string[] = [],
): CalEvent {
  return {
    id,
    title: id,
    allDay: false,
    startMs: at(startHour),
    endMs: at(endHour),
    participantIds,
    expectedVersion: "v1",
  };
}

function allDay(id: string, participantIds: string[] = []): CalEvent {
  return {
    id,
    title: id,
    allDay: true,
    startMs: at(0),
    endMs: at(24),
    participantIds,
    expectedVersion: "v1",
  };
}

const ids = (events: { id: string }[]) => events.map((e) => e.id);

describe("Today day range", () => {
  test("covers the Household civil day", () => {
    expect(dayRange(DAY, ZONE)).toEqual({
      from: "2026-10-08T04:00:00.000Z",
      to: "2026-10-09T04:00:00.000Z",
    });
  });
});

describe("event owners", () => {
  test("are the Active participants; none means everyone", () => {
    expect(eventOwners(event("a", 9, 10, ["ellie", "gone"]), members)).toEqual([
      "ellie",
    ]);
    expect(eventOwners(event("b", 9, 10), members)).toEqual([]);
    expect(eventOwners(event("c", 9, 10, ["gone"]), members)).toEqual([]);
  });
});

describe("Everyone lanes", () => {
  test("each member's lane holds the events they take part in", () => {
    const lanes = dayLanes(
      [
        event("dentist", 9, 10, ["dad"]),
        event("soccer", 17, 18, ["dad", "ellie"]),
        event("art", 15, 16, ["ellie"]),
      ],
      members,
      DAY,
      ZONE,
    );
    expect(ids(lanes.lanes[0].events)).toEqual(["dentist", "soccer"]);
    expect(ids(lanes.lanes[1].events)).toEqual(["art", "soccer"]);
    expect(lanes.bands).toEqual([]);
  });

  test("an event for everyone that clashes with nobody is one band", () => {
    const lanes = dayLanes(
      [event("dentist", 9, 10, ["dad"]), event("dinner", 18, 19)],
      members,
      DAY,
      ZONE,
    );
    expect(ids(lanes.bands)).toEqual(["dinner"]);
    expect(ids(lanes.lanes[0].events)).toEqual(["dentist"]);
    expect(ids(lanes.lanes[1].events)).toEqual([]);
  });

  test("an event for everyone that clashes with a member's event joins every lane", () => {
    const lanes = dayLanes(
      [event("art", 15, 16, ["ellie"]), event("grandma", 14, 17)],
      members,
      DAY,
      ZONE,
    );
    expect(lanes.bands).toEqual([]);
    expect(ids(lanes.lanes[0].events)).toEqual(["grandma"]);
    expect(lanes.lanes[1].events.map((e) => [e.id, e.col, e.cols])).toEqual([
      ["grandma", 0, 2],
      ["art", 1, 2],
    ]);
  });

  test("leaves out all-day events and other days", () => {
    const tomorrow = { ...event("later", 9, 10, ["dad"]) };
    tomorrow.startMs += 86_400_000;
    tomorrow.endMs += 86_400_000;
    const lanes = dayLanes(
      [allDay("picture day", ["ellie"]), tomorrow],
      members,
      DAY,
      ZONE,
    );
    expect(lanes.lanes.flatMap((lane) => lane.events)).toEqual([]);
  });
});

describe("one member's day", () => {
  test("is their events plus everything for everyone", () => {
    const lane = memberDayLane(
      [
        event("dentist", 9, 10, ["dad"]),
        event("art", 15, 16, ["ellie"]),
        event("dinner", 18, 19),
      ],
      ellie,
      members,
      DAY,
      ZONE,
    );
    expect(ids(lane)).toEqual(["art", "dinner"]);
  });

  test("all-day events follow the same filter, everyone's first", () => {
    const events = [
      allDay("picture day", ["ellie"]),
      allDay("grandma visiting"),
      allDay("offsite", ["dad"]),
    ];
    expect(
      ids(allDayEvents(events, members, { kind: "everyone" }, DAY, ZONE)),
    ).toEqual(["grandma visiting", "offsite", "picture day"]);
    expect(
      ids(
        allDayEvents(
          events,
          members,
          { kind: "member", member: "ellie" },
          DAY,
          ZONE,
        ),
      ),
    ).toEqual(["grandma visiting", "picture day"]);
  });
});

describe("day grid", () => {
  test("fits the 7 AM to 9 PM window into the space it has", () => {
    expect(hourHeight(840)).toBe(60);
    expect(hourHeight(300)).toBe(48);
    expect(hourHeight(5000)).toBe(120);
    expect(hourHeight(0)).toBe(60);
  });

  test("places an event by its Household wall-clock time", () => {
    expect(eventBox(event("a", 9, 10), DAY, ZONE, 60)).toEqual({
      top: 120,
      height: 60,
    });
  });

  test("keeps events outside the window visible at its edges", () => {
    expect(eventBox(event("early", 5, 6), DAY, ZONE, 60)).toEqual({
      top: 0,
      height: 36,
    });
    expect(eventBox(event("late", 22, 23), DAY, ZONE, 60)).toEqual({
      top: 804,
      height: 36,
    });
    const overnight = { startMs: at(-3), endMs: at(8) };
    expect(eventBox(overnight, DAY, ZONE, 60)).toEqual({ top: 0, height: 60 });
  });

  test("the now-line shows only inside the window", () => {
    expect(nowOffset(new Date(at(15, 30)), ZONE, 60)).toBe(510);
    expect(nowOffset(new Date(at(6)), ZONE, 60)).toBeNull();
    expect(nowOffset(new Date(at(21)), ZONE, 60)).toBeNull();
  });

  test("a tap picks the hour it lands in", () => {
    expect(hourAt(DAY, 130, ZONE, 60)?.getTime()).toBe(at(9));
    expect(hourAt(DAY, -1, ZONE, 60)).toBeNull();
    expect(hourAt(DAY, 840, ZONE, 60)).toBeNull();
  });
});
