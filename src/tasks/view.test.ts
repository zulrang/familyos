import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { MemberId } from "@/members/members";
import {
  addLocalDays,
  type Instant,
  type LineageId,
  type LocalDate,
  type LocalTime,
  type TaskDefinition,
  type TaskEvent,
  type TaskId,
} from "./types";
import { view } from "./view";

const today = "2026-08-25" as LocalDate;
const dad = "dad" as MemberId;
const ellie = "ellie" as MemberId;
const luke = "luke" as MemberId;

function definition(
  overrides: Partial<TaskDefinition> & Pick<TaskDefinition, "id">,
): TaskDefinition {
  return {
    lineage: "lin-1" as LineageId,
    title: "Dishes",
    type: "chore",
    recurrence: { kind: "daily" },
    assignment: { kind: "fixed", member: dad },
    time: null,
    stars: 0,
    retiredAt: null,
    ...overrides,
  };
}

describe("tasks view", () => {
  test("a daily fixed task appears the same day", () => {
    const occurrences = view(
      [definition({ id: "t1" as TaskId, title: "Walk dog" })],
      [],
      today,
    );
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0]?.title, "Walk dog");
    assert.equal(occurrences[0]?.state, "pending");
    assert.equal(occurrences[0]?.window, today);
    assert.equal(occurrences[0]?.assignee, dad);
    assert.equal(occurrences[0]?.lineage, "lin-1");
  });

  test("timed occurrences sort before untimed, then by creation order", () => {
    const occurrences = view(
      [
        definition({ id: "u1" as TaskId, title: "Untimed first" }),
        definition({
          id: "t-late" as TaskId,
          title: "Late",
          time: "18:00" as LocalTime,
        }),
        definition({
          id: "t-early" as TaskId,
          title: "Early",
          time: "07:00" as LocalTime,
        }),
        definition({ id: "u2" as TaskId, title: "Untimed second" }),
      ],
      [],
      today,
    );
    assert.deepEqual(
      occurrences.map((row) => row.title),
      ["Early", "Late", "Untimed first", "Untimed second"],
    );
  });

  test("a completed event shows done", () => {
    const completed: TaskEvent = {
      kind: "completed",
      task: "t1" as TaskId,
      window: today,
      by: dad,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    const [row] = view(
      [definition({ id: "t1" as TaskId })],
      [completed],
      today,
    );
    assert.equal(row?.state, "done");
    if (row?.state === "done") {
      assert.equal(row.by, dad);
      assert.equal(row.at, "2026-08-25T12:00:00Z");
    }
  });

  test("a completion fact does not change a fixed assignment", () => {
    const completed: TaskEvent = {
      kind: "completed",
      task: "t1" as TaskId,
      window: today,
      by: "ellie" as MemberId,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    const [row] = view(
      [definition({ id: "t1" as TaskId })],
      [completed],
      today,
    );
    assert.equal(row?.state, "done");
    assert.equal(row?.assignee, dad);
    if (row?.state === "done") assert.equal(row.by, "ellie");
  });

  test("yesterday's incomplete daily task does not appear today", () => {
    const occurrences = view([definition({ id: "t1" as TaskId })], [], today);
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0]?.window, today);
    assert.ok(
      occurrences.every((row) => row.window !== addLocalDays(today, -1)),
    );
  });

  test("a completion on yesterday does not mark today done", () => {
    const completed: TaskEvent = {
      kind: "completed",
      task: "t1" as TaskId,
      window: addLocalDays(today, -1),
      by: dad,
      at: "2026-08-24T12:00:00Z" as Instant,
    };
    const [row] = view(
      [definition({ id: "t1" as TaskId })],
      [completed],
      today,
    );
    assert.equal(row?.state, "pending");
  });

  test("retired definitions are omitted", () => {
    const occurrences = view(
      [
        definition({
          id: "t1" as TaskId,
          retiredAt: today,
        }),
      ],
      [],
      today,
    );
    assert.deepEqual(occurrences, []);
  });

  test("unsupported recurrence and open assignment do not throw", () => {
    const occurrences = view(
      [
        definition({
          id: "once" as TaskId,
          recurrence: { kind: "once", date: today },
        }),
        definition({
          id: "weekly" as TaskId,
          recurrence: { kind: "weekly", days: ["mon"] },
        }),
        definition({
          id: "open" as TaskId,
          assignment: { kind: "open" },
        }),
      ],
      [],
      today,
    );
    assert.deepEqual(occurrences, []);
  });

  test("four completed turns assign a three-member rotation to the second member", () => {
    const task = "rotation" as TaskId;
    const completed = [
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ].map(
      (window, index): TaskEvent => ({
        kind: "completed",
        task,
        window: window as LocalDate,
        by: [dad, ellie, luke, dad][index] ?? dad,
        at: `2026-08-${20 + index}T12:00:00Z` as Instant,
      }),
    );
    const [row] = view(
      [
        definition({
          id: task,
          assignment: { kind: "rotation", order: [dad, ellie, luke] },
        }),
      ],
      completed,
      today,
    );
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, ellie);
    assert.equal(
      completed.some((event) => event.window === row?.window),
      false,
    );
  });

  test("a completion in a closed window advances without rendering", () => {
    const task = "rotation-closed" as TaskId;
    const closedWindow = addLocalDays(today, -1);
    const [row] = view(
      [
        definition({
          id: task,
          assignment: { kind: "rotation", order: [dad, ellie] },
        }),
      ],
      [
        {
          kind: "completed",
          task,
          window: closedWindow,
          by: dad,
          at: "2026-08-24T12:00:00Z" as Instant,
        },
      ],
      today,
    );
    assert.equal(row?.window, today);
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, ellie);
  });

  test("a skip does not advance a rotation", () => {
    const task = "rotation-skip" as TaskId;
    const [row] = view(
      [
        definition({
          id: task,
          assignment: { kind: "rotation", order: [dad, ellie] },
        }),
      ],
      [
        {
          kind: "skipped",
          task,
          window: addLocalDays(today, -1),
          reason: null,
        },
      ],
      today,
    );
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, dad);
  });

  test("a completed rotation stays with its completer", () => {
    const task = "rotation-done" as TaskId;
    const [row] = view(
      [
        definition({
          id: task,
          assignment: { kind: "rotation", order: [dad, ellie] },
        }),
      ],
      [
        {
          kind: "completed",
          task,
          window: today,
          by: dad,
          at: "2026-08-25T12:00:00Z" as Instant,
        },
      ],
      today,
    );
    assert.equal(row?.state, "done");
    assert.equal(row?.assignee, dad);
    if (row?.state === "done") assert.equal(row.by, dad);
  });

  test("verified is metadata and does not change pending", () => {
    const events: TaskEvent[] = [
      {
        kind: "verified",
        task: "t1" as TaskId,
        window: today,
        by: dad,
        at: "2026-08-25T12:00:00Z" as Instant,
      },
    ];
    const [row] = view([definition({ id: "t1" as TaskId })], events, today);
    assert.equal(row?.state, "pending");
  });
});
