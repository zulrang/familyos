import assert from "node:assert/strict";
import {
  addDays,
  colorIdForTones,
  coversDay,
  DAY_COUNT,
  eventTone,
  formatTimeRange,
  fromDateAndTime,
  fromDateOnly,
  googleDateTime,
  gridHeight,
  HOUR_PX,
  layoutColumns,
  MULTI_COLOR_ID,
  mountGridScrollTop,
  NOW_LINE_PX,
  nowLineTop,
  nowLineY,
  peopleOf,
  presentationTonesFor,
  remainingDays,
  slotStart,
  startOfDay,
  statusEvent,
  TONE_COLOR_ID,
  toneFromColorId,
  visibleUnderMemberFilter,
  weekDays,
} from "./calendar.ts";
import { type CalEvent, MEMBER_TONES, type Member } from "./types.ts";

const wed = new Date(2026, 7, 19, 11, 20);
assert.equal(DAY_COUNT, 7);
const days = weekDays(wed);
assert.equal(days.length, 7);
assert.equal(days[0].getDate(), 19);
assert.equal(days[0].getHours(), 0);
assert.equal(days[6].getDate(), 25);
assert.equal(weekDays(wed, 5).length, 5);

assert.equal(
  formatTimeRange(
    fromDateAndTime("2026-08-19", "10:00"),
    fromDateAndTime("2026-08-19", "11:30"),
  ),
  "10 - 11:30 AM",
);
assert.equal(
  formatTimeRange(
    fromDateAndTime("2026-08-19", "09:30"),
    fromDateAndTime("2026-08-19", "10:15"),
  ),
  "9:30 - 10:15 AM",
);
assert.equal(
  formatTimeRange(
    fromDateAndTime("2026-08-19", "11:00"),
    fromDateAndTime("2026-08-19", "12:00"),
  ),
  "11 AM - 12 PM",
);

const wed350 = fromDateAndTime("2026-08-19", "15:50");
assert.equal(new Date(googleDateTime(wed350).dateTime).getTime(), wed350);
assert.equal(
  googleDateTime(Date.UTC(2026, 7, 20, 19, 50, 0)).dateTime,
  "2026-08-20T19:50:00.000Z",
);
assert.deepEqual(
  googleDateTime(Date.UTC(2026, 7, 24, 19, 50, 0), "America/New_York"),
  { dateTime: "2026-08-24T15:50:00", timeZone: "America/New_York" },
);

const a = { startMs: 0, endMs: 60 };
const b = { startMs: 30, endMs: 90 };
const c = { startMs: 100, endMs: 140 };
const laid = layoutColumns([c, b, a]);
const byStart = Object.fromEntries(laid.map((e) => [e.startMs, e]));
assert.equal(byStart[0].cols, 2);
assert.equal(byStart[30].cols, 2);
assert.notEqual(byStart[0].col, byStart[30].col);
assert.equal(byStart[100].cols, 1);

const members: Member[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "mom", name: "Mom", status: "active", color: "#f9c0bc" },
  { id: "ex", name: "Ex", status: "retired" },
];
const ev: CalEvent = {
  id: "1",
  title: "Bath",
  allDay: false,
  startMs: 0,
  endMs: 1,
  participantIds: ["dad", "mom"],
};
assert.deepEqual(
  peopleOf(members, ev).map((m) => m.id),
  ["dad", "mom"],
);
assert.deepEqual(eventTone(peopleOf(members, ev)), {
  tone: "teal",
  multi: true,
});
assert.deepEqual(
  eventTone(peopleOf(members, { ...ev, participantIds: ["dad"] })),
  { tone: "teal", multi: false },
);
assert.deepEqual(eventTone([]), { tone: "sand", multi: false });

// Retired Member retains historical identity
assert.deepEqual(
  peopleOf(members, { ...ev, participantIds: ["ex"] }).map((m) => m.id),
  ["ex"],
);
assert.deepEqual(
  eventTone(peopleOf(members, { ...ev, participantIds: ["ex", "dad"] })),
  { tone: "teal", multi: true },
);

// Color / email never establish participation — only stored IDs
assert.deepEqual(
  peopleOf(members, { ...ev, participantIds: [] }).map((m) => m.id),
  [],
);

// Household Event visible under every member filter
const household: CalEvent = { ...ev, participantIds: [] };
assert.equal(visibleUnderMemberFilter(household, members, { dad: true }), true);
assert.equal(
  visibleUnderMemberFilter(ev, members, { dad: true, mom: true }),
  false,
);
assert.equal(
  visibleUnderMemberFilter(ev, members, { dad: true, mom: false }),
  true,
);
// Non-empty IDs that resolve to nobody are not Household Events
assert.equal(
  visibleUnderMemberFilter({ ...ev, participantIds: ["ghost"] }, members, {}),
  false,
);

const kids: Member[] = [
  { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
  { id: "harper", name: "Harper", status: "active", color: "#dccfea" },
];
assert.deepEqual(
  peopleOf(kids, { ...ev, participantIds: ["ellie"] }).map((m) => m.id),
  ["ellie"],
);
assert.deepEqual(
  peopleOf(kids, { ...ev, participantIds: ["ellie", "harper"] }).map(
    (m) => m.id,
  ),
  ["ellie", "harper"],
);

assert.equal(new Set(Object.values(TONE_COLOR_ID)).size, MEMBER_TONES.length);
for (const t of MEMBER_TONES) {
  assert.equal(toneFromColorId(TONE_COLOR_ID[t]), t);
}
assert.equal(colorIdForTones(["blush"]), TONE_COLOR_ID.blush);
assert.equal(colorIdForTones(["blush", "lilac"]), MULTI_COLOR_ID);
assert.equal(colorIdForTones([]), null);
assert.deepEqual(presentationTonesFor(members, ["dad", "mom"]), [
  "teal",
  "coral",
]);
assert.deepEqual(presentationTonesFor(members, ["ex"]), []);

const trip: CalEvent = {
  id: "v",
  title: "Vacation",
  allDay: true,
  startMs: fromDateOnly("2026-08-01"),
  endMs: fromDateOnly("2026-09-18"),
  participantIds: [],
};
assert.equal(coversDay(trip, new Date(2026, 7, 19)), true);
assert.equal(coversDay(trip, new Date(2026, 8, 18)), false);
assert.equal(remainingDays(trip, new Date(2026, 7, 19)), 30);
assert.equal(statusEvent([trip], new Date(2026, 7, 19))?.title, "Vacation");
assert.equal(startOfDay(addDays(wed, 1)).getDate(), 20);

const slotDay = new Date(2026, 7, 19);
assert.equal(slotStart(slotDay, 0)?.getHours(), 7);
assert.equal(slotStart(slotDay, 119)?.getHours(), 7);
assert.equal(slotStart(slotDay, 120)?.getHours(), 8);
assert.equal(slotStart(slotDay, 13 * 120)?.getHours(), 20);
assert.equal(slotStart(slotDay, 14 * 120), null);
assert.equal(slotStart(slotDay, -1), null);

const morning = new Date(2026, 7, 17, 11, 20);
assert.equal(nowLineY(morning), nowLineTop(morning));
assert.equal(nowLineY(new Date(2026, 7, 17, 6, 0)), 0);
assert.equal(
  nowLineY(new Date(2026, 7, 17, 22, 0)),
  gridHeight() - NOW_LINE_PX,
);

const evening = new Date(2026, 7, 17, 20, 30);
assert.equal(mountGridScrollTop(null, evening), nowLineTop(evening) - HOUR_PX);
assert.equal(mountGridScrollTop(0, evening), 0);
assert.equal(mountGridScrollTop(240, evening), 240);
assert.equal(mountGridScrollTop(null, morning), nowLineTop(morning) - HOUR_PX);
assert.equal(mountGridScrollTop(80, morning), 80);

console.log("calendar.check ok");
