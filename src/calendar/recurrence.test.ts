import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  followingRecurrence,
  isSeriesHead,
  parseScope,
  rruleCount,
  shiftRecurrenceStart,
  stampMs,
  truncateRecurrence,
  untilStamp,
} from "./recurrence";

const HOST = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("event series recurrence", () => {
  test("parses edit scope with this as the default", () => {
    assert.equal(parseScope("following"), "following");
    assert.equal(parseScope("all"), "all");
    assert.equal(parseScope("this"), "this");
    assert.equal(parseScope("nope"), "this");
    assert.equal(parseScope(undefined), "this");
  });

  test("recognizes the series head by original vs instance start", () => {
    assert.equal(isSeriesHead(1_000_000, 1_000_400), true);
    assert.equal(isSeriesHead(1_000_000, 2_000_000), false);
  });

  test("builds UNTIL stamps for all-day and timed instances", () => {
    const allDay = new Date(2026, 7, 17).getTime();
    assert.equal(
      untilStamp({ originalStartMs: allDay, allDay: true, timeZone: HOST }),
      "20260816",
    );

    const timed = Date.UTC(2026, 7, 18, 19, 0, 0);
    assert.equal(
      untilStamp({ originalStartMs: timed, allDay: false, timeZone: HOST }),
      "20260818T185959Z",
    );
  });

  test("reads COUNT from an RRULE or returns null when absent", () => {
    assert.equal(rruleCount(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"]), 10);
    assert.equal(rruleCount(["RRULE:FREQ=WEEKLY;BYDAY=MO"]), null);
  });

  test("truncates a counted series and continues the remainder", () => {
    const timed = Date.UTC(2026, 7, 18, 19, 0, 0);
    const weekly = ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"];
    assert.deepEqual(
      truncateRecurrence(weekly, "20260816T185959Z", timed, HOST),
      ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260816T185959Z"],
    );
    assert.deepEqual(followingRecurrence(weekly, timed, 7, HOST), [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=7",
    ]);
  });

  test("keeps an UNTIL rule when continuing following instances", () => {
    const timed = Date.UTC(2026, 7, 18, 19, 0, 0);
    const untilRule = ["RRULE:FREQ=WEEKLY;UNTIL=20261201T000000Z"];
    assert.deepEqual(
      followingRecurrence(untilRule, timed, null, HOST),
      untilRule,
    );
  });

  test("splits EXDATE entries across truncate and following halves", () => {
    const split = stampMs("20260817T150000Z", HOST);
    const withEx = [
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260803T150000Z,20260817T150000Z",
    ];
    assert.deepEqual(
      truncateRecurrence(withEx, "20260816T145959Z", split, HOST),
      ["RRULE:FREQ=WEEKLY;UNTIL=20260816T145959Z", "EXDATE:20260803T150000Z"],
    );
    assert.deepEqual(followingRecurrence(withEx, split, null, HOST), [
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260817T150000Z",
    ]);
  });

  test("shifts BYDAY and BYMONTHDAY when the series start moves", () => {
    const wedMs = new Date(2026, 7, 19).getTime();
    assert.equal(
      shiftRecurrenceStart(["RRULE:FREQ=WEEKLY;BYDAY=MO"], wedMs, HOST)[0],
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
    );
    assert.equal(
      shiftRecurrenceStart(
        ["RRULE:FREQ=MONTHLY;BYMONTHDAY=17"],
        wedMs,
        HOST,
      )[0],
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=19",
    );
    assert.deepEqual(shiftRecurrenceStart(["RRULE:FREQ=DAILY"], wedMs, HOST), [
      "RRULE:FREQ=DAILY",
    ]);
    assert.equal(
      shiftRecurrenceStart(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], wedMs, HOST)[0],
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    );
  });
});
