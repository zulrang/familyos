import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { MemberId } from "@/members/members";
import {
  addLocalDays,
  type Instant,
  type LineageId,
  type LocalDate,
  type LocalTime,
  parseRecurrence,
  type Recurrence,
  type StarAdjustment,
  type TaskDefinition,
  type TaskEvent,
  type TaskId,
} from "./types";
import { starBalances, view } from "./view";

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

function mustParseRecurrence(raw: unknown): Recurrence {
  const parsed = parseRecurrence(raw);
  assert.ok(parsed);
  return parsed;
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

  test("a daily open task is pending and unclaimed", () => {
    const [row] = view(
      [
        definition({
          id: "open" as TaskId,
          assignment: { kind: "open" },
        }),
      ],
      [],
      today,
    );
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, null);
  });

  test("a claim places an open occurrence with its first claimant", () => {
    const task = "open" as TaskId;
    const claims: TaskEvent[] = [
      { kind: "claimed", task, window: today, by: ellie },
      { kind: "claimed", task, window: today, by: dad },
    ];
    const [row] = view(
      [definition({ id: task, assignment: { kind: "open" } })],
      claims,
      today,
    );
    assert.equal(row?.state, "claimed");
    assert.equal(row?.assignee, ellie);
    if (row?.state === "claimed") assert.equal(row.by, ellie);
  });

  test("an unclaimed open completion is attributed to its member", () => {
    const task = "open" as TaskId;
    const completed: TaskEvent = {
      kind: "completed",
      task,
      window: today,
      by: ellie,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    const [row] = view(
      [definition({ id: task, assignment: { kind: "open" } })],
      [completed],
      today,
    );
    assert.equal(row?.state, "done");
    assert.equal(row?.assignee, ellie);
    if (row?.state === "done") assert.equal(row.by, ellie);
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

  test("a weekly task stays pending through its window and replaces the expired occurrence", () => {
    const task = definition({
      id: "weekly" as TaskId,
      recurrence: { kind: "weekly", days: ["mon"] },
    });
    for (const date of [
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ] as LocalDate[]) {
      const rows = view([task], [], date);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.state, "pending");
      assert.equal(rows[0]?.window, "2026-08-24");
    }
    const nextMonday = view([task], [], "2026-08-31" as LocalDate);
    assert.equal(nextMonday.length, 1);
    assert.equal(nextMonday[0]?.state, "pending");
    assert.equal(nextMonday[0]?.window, "2026-08-31");
    assert.ok(nextMonday.every((row) => row.window !== "2026-08-24"));
  });

  test("each selected weekly day starts a new window", () => {
    const task = definition({
      id: "weekly" as TaskId,
      recurrence: { kind: "weekly", days: ["mon", "thu"] },
    });
    const windowsByDate = [
      ["2026-08-24", "2026-08-24"],
      ["2026-08-26", "2026-08-24"],
      ["2026-08-27", "2026-08-27"],
      ["2026-08-30", "2026-08-27"],
      ["2026-08-31", "2026-08-31"],
    ] as const;
    for (const [date, expectedWindow] of windowsByDate) {
      const [row] = view([task], [], date as LocalDate);
      assert.equal(row?.window, expectedWindow);
      assert.equal(row?.state, "pending");
    }
  });

  test("a weekly rotation advances from a closed completion while stars use its definition", () => {
    const task = definition({
      id: "weekly-rotation" as TaskId,
      recurrence: { kind: "weekly", days: ["mon"] },
      assignment: { kind: "rotation", order: [dad, ellie] },
      stars: 6,
    });
    const completed: TaskEvent = {
      kind: "completed",
      task: task.id,
      window: "2026-08-17" as LocalDate,
      by: dad,
      at: "2026-08-17T12:00:00Z" as Instant,
    };

    const [row] = view([task], [completed], today);

    assert.equal(row?.window, "2026-08-24");
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, ellie);
    assert.deepEqual(starBalances([task], [completed], []), [
      { member: dad, balance: 6 },
    ]);
  });

  test("a once task appears only on its scheduled date", () => {
    const task = definition({
      id: "once" as TaskId,
      recurrence: { kind: "once", date: today },
    });
    assert.deepEqual(view([task], [], addLocalDays(today, -1)), []);
    assert.equal(view([task], [], today)[0]?.window, today);
    assert.deepEqual(view([task], [], addLocalDays(today, 1)), []);
  });

  test("a monthly task stays open until next month's scheduled day", () => {
    const task = definition({
      id: "monthly" as TaskId,
      recurrence: mustParseRecurrence({ kind: "monthly", day: 10 }),
    });
    assert.equal(
      view([task], [], "2026-08-27" as LocalDate)[0]?.window,
      "2026-08-10",
    );
    assert.equal(
      view([task], [], "2026-09-09" as LocalDate)[0]?.window,
      "2026-08-10",
    );
    assert.equal(
      view([task], [], "2026-09-10" as LocalDate)[0]?.window,
      "2026-09-10",
    );
  });

  test("a weekly open task can be claimed or completed during its window", () => {
    const task = definition({
      id: "weekly-open" as TaskId,
      recurrence: { kind: "weekly", days: ["mon"] },
      assignment: { kind: "open" },
      stars: 4,
    });
    const window = "2026-08-24" as LocalDate;
    const claim: TaskEvent = {
      kind: "claimed",
      task: task.id,
      window,
      by: ellie,
    };
    const [claimed] = view([task], [claim], today);
    assert.equal(claimed?.window, window);
    assert.equal(claimed?.state, "claimed");
    assert.equal(claimed?.assignee, ellie);

    const completion: TaskEvent = {
      kind: "completed",
      task: task.id,
      window,
      by: dad,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    const [completed] = view([task], [claim, completion], today);
    assert.equal(completed?.state, "done");
    assert.equal(completed?.assignee, dad);
    if (completed?.state === "done") assert.equal(completed.by, dad);
    assert.deepEqual(starBalances([task], [claim, completion], []), [
      { member: dad, balance: 4 },
    ]);
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

  test("star balances use each completion's exact definition across retired ids and closed windows", () => {
    const definitions = [
      definition({
        id: "old" as TaskId,
        lineage: "shared" as LineageId,
        stars: 3,
        retiredAt: today,
      }),
      definition({
        id: "new" as TaskId,
        lineage: "shared" as LineageId,
        stars: 8,
      }),
    ];
    const events: TaskEvent[] = [
      {
        kind: "completed",
        task: "old" as TaskId,
        window: addLocalDays(today, -10),
        by: dad,
        at: "2026-08-15T12:00:00Z" as Instant,
      },
      {
        kind: "completed",
        task: "missing" as TaskId,
        window: today,
        by: dad,
        at: "2026-08-25T12:00:00Z" as Instant,
      },
    ];
    assert.deepEqual(starBalances(definitions, events, []), [
      { member: dad, balance: 3 },
    ]);
  });

  test("star adjustments add to earned balances and can introduce a member", () => {
    const ellie = "ellie" as MemberId;
    const events: TaskEvent[] = [
      {
        kind: "completed",
        task: "t1" as TaskId,
        window: today,
        by: dad,
        at: "2026-08-25T12:00:00Z" as Instant,
      },
    ];
    const adjustments: StarAdjustment[] = [
      {
        id: "spend",
        member: dad,
        delta: -2,
        reason: "Reward",
        at: "2026-08-25T13:00:00Z" as Instant,
      },
      {
        id: "bonus",
        member: ellie,
        delta: 4,
        reason: null,
        at: "2026-08-25T14:00:00Z" as Instant,
      },
    ];
    assert.deepEqual(
      starBalances(
        [definition({ id: "t1" as TaskId, stars: 5 })],
        events,
        adjustments,
      ),
      [
        { member: dad, balance: 3 },
        { member: ellie, balance: 4 },
      ],
    );
  });

  test("star balances reject an unsafe accumulated value", () => {
    const events: TaskEvent[] = [
      {
        kind: "completed",
        task: "t1" as TaskId,
        window: today,
        by: dad,
        at: "2026-08-25T12:00:00Z" as Instant,
      },
      {
        kind: "completed",
        task: "t1" as TaskId,
        window: addLocalDays(today, -1),
        by: dad,
        at: "2026-08-24T12:00:00Z" as Instant,
      },
    ];

    assert.throws(
      () =>
        starBalances(
          [definition({ id: "t1" as TaskId, stars: Number.MAX_SAFE_INTEGER })],
          events,
          [],
        ),
      new RangeError("star balance exceeds safe integer range"),
    );
  });
});
