import assert from "node:assert/strict";
import { test } from "vitest";
import {
  followingRecurrence,
  isSeriesHead,
  parseScope,
  rruleCount,
  shiftRecurrenceStart,
  stampMs,
  truncateRecurrence,
  untilStamp,
} from "./recurrence.ts";

test("recurrence", () => {
  assert.equal(parseScope("following"), "following");
  assert.equal(parseScope("all"), "all");
  assert.equal(parseScope("this"), "this");
  assert.equal(parseScope("nope"), "this");
  assert.equal(parseScope(undefined), "this");

  assert.equal(isSeriesHead(1_000_000, 1_000_400), true);
  assert.equal(isSeriesHead(1_000_000, 2_000_000), false);

  const allDay = new Date(2026, 7, 17).getTime();
  assert.equal(
    untilStamp({ originalStartMs: allDay, allDay: true }),
    "20260816",
  );

  const timed = Date.UTC(2026, 7, 18, 19, 0, 0);
  assert.equal(
    untilStamp({ originalStartMs: timed, allDay: false }),
    "20260818T185959Z",
  );

  assert.equal(rruleCount(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"]), 10);
  assert.equal(rruleCount(["RRULE:FREQ=WEEKLY;BYDAY=MO"]), null);

  const weekly = ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"];
  assert.deepEqual(truncateRecurrence(weekly, "20260816T185959Z", timed), [
    "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260816T185959Z",
  ]);
  assert.deepEqual(followingRecurrence(weekly, timed, 7), [
    "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=7",
  ]);

  const untilRule = ["RRULE:FREQ=WEEKLY;UNTIL=20261201T000000Z"];
  assert.deepEqual(followingRecurrence(untilRule, timed, null), untilRule);

  const split = stampMs("20260817T150000Z");
  const withEx = [
    "RRULE:FREQ=WEEKLY",
    "EXDATE:20260803T150000Z,20260817T150000Z",
  ];
  assert.deepEqual(truncateRecurrence(withEx, "20260816T145959Z", split), [
    "RRULE:FREQ=WEEKLY;UNTIL=20260816T145959Z",
    "EXDATE:20260803T150000Z",
  ]);
  assert.deepEqual(followingRecurrence(withEx, split, null), [
    "RRULE:FREQ=WEEKLY",
    "EXDATE:20260817T150000Z",
  ]);

  const wedMs = new Date(2026, 7, 19).getTime();
  assert.equal(
    shiftRecurrenceStart(["RRULE:FREQ=WEEKLY;BYDAY=MO"], wedMs)[0],
    "RRULE:FREQ=WEEKLY;BYDAY=WE",
  );
  assert.equal(
    shiftRecurrenceStart(["RRULE:FREQ=MONTHLY;BYMONTHDAY=17"], wedMs)[0],
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=19",
  );
  assert.deepEqual(shiftRecurrenceStart(["RRULE:FREQ=DAILY"], wedMs), [
    "RRULE:FREQ=DAILY",
  ]);
  assert.equal(
    shiftRecurrenceStart(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], wedMs)[0],
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
  );
});
