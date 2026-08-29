import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { MemberId } from "@/members/members";
import {
  applyEvent,
  insertDefinition,
  loadDefinitions,
  loadEvents,
  loadStarAdjustments,
  saveDefinition,
  tasksDatabase,
} from "./store";
import type {
  CreateTaskDraft,
  Instant,
  LineageId,
  LocalDate,
  LocalTime,
  TaskDefinition,
  TaskEvent,
  TaskId,
} from "./types";
import { starBalances, view } from "./view";

describe("tasks sqlite store", () => {
  let dataRoot: string;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-tasks-store-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function definition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
    return {
      id: crypto.randomUUID() as TaskId,
      lineage: crypto.randomUUID() as LineageId,
      title: "Dishes",
      type: "chore",
      recurrence: { kind: "daily" },
      assignment: { kind: "fixed", member: "dad" as MemberId },
      time: null,
      stars: 0,
      retiredAt: null,
      ...overrides,
    };
  }

  function draftFrom(
    def: TaskDefinition,
    overrides: Partial<CreateTaskDraft> = {},
  ): CreateTaskDraft {
    return {
      title: def.title,
      type: def.type,
      recurrence: def.recurrence,
      assignment: def.assignment,
      time: def.time,
      stars: def.stars,
      ...overrides,
    };
  }

  test("all three tables exist and user_version is 2", () => {
    const db = tasksDatabase();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    assert.deepEqual(
      tables
        .map((row) => row.name)
        .filter((name) => !name.startsWith("sqlite_")),
      ["definitions", "events", "star_adjustments"],
    );
    const version = db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(version.user_version, 2);
  });

  test("persists full recurrence and assignment unions", () => {
    const weekly = definition({
      recurrence: { kind: "weekly", days: ["mon", "thu"] },
      assignment: {
        kind: "rotation",
        order: ["dad" as MemberId, "ellie" as MemberId],
      },
    });
    insertDefinition(weekly);
    const stored = loadDefinitions().find((row) => row.id === weekly.id);
    assert.deepEqual(stored?.recurrence, weekly.recurrence);
    assert.deepEqual(stored?.assignment, weekly.assignment);
  });

  test("unique (task, window, kind) treats a duplicate as already-present", () => {
    const task = crypto.randomUUID() as TaskId;
    const event: TaskEvent = {
      kind: "completed",
      task,
      window: "2026-08-25" as LocalDate,
      by: "dad" as MemberId,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    assert.equal(applyEvent(event).status, "inserted");
    assert.equal(applyEvent(event).status, "already-present");
    const stored = loadEvents().filter(
      (row) => row.task === task && row.kind === "completed",
    );
    assert.equal(stored.length, 1);
  });

  test("a duplicate claim keeps the first accepted claimant", () => {
    const task = crypto.randomUUID() as TaskId;
    const window = "2026-08-25" as LocalDate;
    assert.equal(
      applyEvent({
        kind: "claimed",
        task,
        window,
        by: "dad" as MemberId,
      }).status,
      "inserted",
    );
    assert.equal(
      applyEvent({
        kind: "claimed",
        task,
        window,
        by: "ellie" as MemberId,
      }).status,
      "already-present",
    );
    const claims = loadEvents().filter(
      (row) =>
        row.task === task && row.window === window && row.kind === "claimed",
    );
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.kind === "claimed" ? claims[0].by : null, "dad");
  });

  test("verified requires a matching completed event", () => {
    const task = crypto.randomUUID() as TaskId;
    const window = "2026-08-25" as LocalDate;
    const verified: TaskEvent = {
      kind: "verified",
      task,
      window,
      by: "dad" as MemberId,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    const rejected = applyEvent(verified);
    assert.equal(rejected.status, "rejected");
    if (rejected.status === "rejected") {
      assert.equal(rejected.error, "verified requires completed");
    }
    assert.equal(
      applyEvent({
        kind: "completed",
        task,
        window,
        by: "dad" as MemberId,
        at: "2026-08-25T12:00:00Z" as Instant,
      }).status,
      "inserted",
    );
    assert.equal(applyEvent(verified).status, "inserted");
  });

  test("changing only title, type, time, or stars overwrites the current definition", () => {
    const def = definition({
      title: "Dishes",
      type: "chore",
      time: null,
      stars: 1,
    });
    insertDefinition(def);
    const saved = saveDefinition({
      id: def.id,
      draft: {
        title: "Trash",
        type: "routine",
        recurrence: def.recurrence,
        assignment: def.assignment,
        time: "07:00" as LocalTime,
        stars: 4,
      },
      today: "2026-08-25" as LocalDate,
    });
    assert.equal(saved.id, def.id);
    assert.equal(saved.lineage, def.lineage);
    assert.equal(saved.retiredAt, null);
    assert.equal(saved.title, "Trash");
    assert.equal(saved.type, "routine");
    assert.equal(saved.time, "07:00");
    assert.equal(saved.stars, 4);
    const stored = loadDefinitions().filter(
      (row) => row.lineage === def.lineage,
    );
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0], saved);
  });

  test("changing recurrence or assignment retires the old definition and inserts a new one", () => {
    const def = definition();
    insertDefinition(def);
    const saved = saveDefinition({
      id: def.id,
      draft: draftFrom(def, { recurrence: { kind: "weekly", days: ["mon"] } }),
      today: "2026-08-25" as LocalDate,
    });
    assert.notEqual(saved.id, def.id);
    assert.equal(saved.lineage, def.lineage);
    assert.equal(saved.retiredAt, null);
    assert.deepEqual(saved.recurrence, { kind: "weekly", days: ["mon"] });
    const old = loadDefinitions().find((row) => row.id === def.id);
    assert.equal(old?.retiredAt, "2026-08-25");
    assert.equal(old?.title, def.title);
  });

  test("a title-and-assignment save is one replace that leaves the old title alone", () => {
    const def = definition({ title: "Dishes" });
    insertDefinition(def);
    const saved = saveDefinition({
      id: def.id,
      draft: draftFrom(def, {
        title: "Kitchen",
        assignment: { kind: "fixed", member: "ellie" as MemberId },
      }),
      today: "2026-08-25" as LocalDate,
    });
    assert.notEqual(saved.id, def.id);
    assert.equal(saved.title, "Kitchen");
    assert.deepEqual(saved.assignment, {
      kind: "fixed",
      member: "ellie",
    });
    const old = loadDefinitions().find((row) => row.id === def.id);
    assert.equal(old?.title, "Dishes");
    assert.equal(old?.retiredAt, "2026-08-25");
    assert.equal(
      loadDefinitions().filter((row) => row.lineage === def.lineage).length,
      2,
    );
  });

  test("retire-and-replace of a rotation pre-rotates the old order by its completions", () => {
    const dad = "dad" as MemberId;
    const ellie = "ellie" as MemberId;
    const luke = "luke" as MemberId;
    const def = definition({
      assignment: { kind: "rotation", order: [dad, ellie, luke] },
    });
    insertDefinition(def);
    assert.equal(
      applyEvent({
        kind: "completed",
        task: def.id,
        window: "2026-08-24" as LocalDate,
        by: dad,
        at: "2026-08-24T12:00:00Z" as Instant,
      }).status,
      "inserted",
    );
    const saved = saveDefinition({
      id: def.id,
      draft: draftFrom(def, { recurrence: { kind: "weekly", days: ["mon"] } }),
      today: "2026-08-25" as LocalDate,
    });
    assert.deepEqual(saved.assignment, {
      kind: "rotation",
      order: [ellie, luke, dad],
    });
    const [row] = view([saved], [], "2026-08-25" as LocalDate);
    assert.equal(row?.assignee, ellie);
  });

  test("a title-only save does not mint a new id or rotate the order", () => {
    const dad = "dad" as MemberId;
    const ellie = "ellie" as MemberId;
    const luke = "luke" as MemberId;
    const def = definition({
      assignment: { kind: "rotation", order: [dad, ellie, luke] },
    });
    insertDefinition(def);
    applyEvent({
      kind: "completed",
      task: def.id,
      window: "2026-08-24" as LocalDate,
      by: dad,
      at: "2026-08-24T12:00:00Z" as Instant,
    });
    const saved = saveDefinition({
      id: def.id,
      draft: draftFrom(def, { title: "Kitchen" }),
      today: "2026-08-25" as LocalDate,
    });
    assert.equal(saved.id, def.id);
    assert.deepEqual(saved.assignment, {
      kind: "rotation",
      order: [dad, ellie, luke],
    });
    const events = loadEvents().filter((event) => event.task === def.id);
    const [row] = view([saved], events, "2026-08-25" as LocalDate);
    assert.equal(row?.assignee, ellie);
  });

  test("a completion against a retired id is accepted and stays out of the projection", () => {
    const def = definition();
    insertDefinition(def);
    const saved = saveDefinition({
      id: def.id,
      draft: draftFrom(def, { assignment: { kind: "open" } }),
      today: "2026-08-25" as LocalDate,
    });
    const receipt = applyEvent({
      kind: "completed",
      task: def.id,
      window: "2026-08-25" as LocalDate,
      by: "dad" as MemberId,
      at: "2026-08-25T12:00:00Z" as Instant,
    });
    assert.equal(receipt.status, "inserted");
    const today = "2026-08-25" as LocalDate;
    const occurrences = view(loadDefinitions(), loadEvents(), today);
    assert.equal(
      occurrences.some((row) => row.task === def.id),
      false,
    );
    assert.equal(
      occurrences.find((row) => row.task === saved.id)?.state,
      "pending",
    );
  });

  test("a completion against the same id after a title-only save appears in the projection", () => {
    const def = definition({ title: "Dishes" });
    insertDefinition(def);
    const saved = saveDefinition({
      id: def.id,
      draft: draftFrom(def, { title: "Trash" }),
      today: "2026-08-25" as LocalDate,
    });
    assert.equal(saved.id, def.id);
    const receipt = applyEvent({
      kind: "completed",
      task: def.id,
      window: "2026-08-25" as LocalDate,
      by: "dad" as MemberId,
      at: "2026-08-25T12:00:00Z" as Instant,
    });
    assert.equal(receipt.status, "inserted");
    const mine = view(
      loadDefinitions(),
      loadEvents(),
      "2026-08-25" as LocalDate,
    ).find((occurrence) => occurrence.task === def.id);
    assert.equal(mine?.state, "done");
    assert.equal(mine?.title, "Trash");
  });

  test("in-place stars revalue that id; a replace freezes the retired row", () => {
    const def = definition({ stars: 3 });
    insertDefinition(def);
    applyEvent({
      kind: "completed",
      task: def.id,
      window: "2026-08-24" as LocalDate,
      by: "dad" as MemberId,
      at: "2026-08-24T12:00:00Z" as Instant,
    });
    saveDefinition({
      id: def.id,
      draft: draftFrom(def, { stars: 8 }),
      today: "2026-08-25" as LocalDate,
    });
    assert.deepEqual(starBalances(loadDefinitions(), loadEvents(), []), [
      { member: "dad", balance: 8 },
    ]);

    const other = definition({ stars: 3, title: "Bins" });
    insertDefinition(other);
    applyEvent({
      kind: "completed",
      task: other.id,
      window: "2026-08-24" as LocalDate,
      by: "ellie" as MemberId,
      at: "2026-08-24T12:00:00Z" as Instant,
    });
    const replaced = saveDefinition({
      id: other.id,
      draft: draftFrom(other, {
        stars: 9,
        assignment: { kind: "open" },
      }),
      today: "2026-08-25" as LocalDate,
    });
    assert.notEqual(replaced.id, other.id);
    assert.equal(
      loadDefinitions().find((row) => row.id === other.id)?.stars,
      3,
    );
    assert.equal(replaced.stars, 9);
    assert.equal(
      starBalances(loadDefinitions(), loadEvents(), []).find(
        (row) => row.member === "ellie",
      )?.balance,
      3,
    );
  });

  test("retiredAt is write-once", () => {
    const def = definition();
    insertDefinition(def);
    const db = tasksDatabase();
    db.prepare("UPDATE definitions SET retired_at = ? WHERE id = ?").run(
      "2026-08-25",
      def.id,
    );
    assert.equal(
      loadDefinitions().find((row) => row.id === def.id)?.retiredAt,
      "2026-08-25",
    );
    assert.throws(() => {
      db.prepare("UPDATE definitions SET retired_at = ? WHERE id = ?").run(
        "2026-08-26",
        def.id,
      );
    }, /retired definition is frozen/);
    assert.throws(() => {
      db.prepare("UPDATE definitions SET title = ? WHERE id = ?").run(
        "Trash",
        def.id,
      );
    }, /retired definition is frozen/);
  });

  test("recurrence and assignment cannot be overwritten in place", () => {
    const def = definition();
    insertDefinition(def);
    const db = tasksDatabase();
    assert.throws(() => {
      db.prepare("UPDATE definitions SET recurrence = ? WHERE id = ?").run(
        JSON.stringify({ kind: "weekly", days: ["mon"] }),
        def.id,
      );
    }, /immutable/);
    assert.throws(() => {
      db.prepare("UPDATE definitions SET assignment = ? WHERE id = ?").run(
        JSON.stringify({ kind: "open" }),
        def.id,
      );
    }, /immutable/);
  });

  test("stars are nonnegative", () => {
    const db = tasksDatabase();
    assert.throws(() => {
      db.prepare(
        `INSERT INTO definitions
          (id, lineage, title, type, recurrence, assignment, time, stars, retired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        crypto.randomUUID(),
        "Bad",
        "chore",
        JSON.stringify({ kind: "daily" }),
        JSON.stringify({ kind: "fixed", member: "dad" }),
        null,
        -1,
        null,
      );
    });
  });

  test("definitions cannot be deleted and events are append-only", () => {
    const def = definition();
    insertDefinition(def);
    const db = tasksDatabase();
    assert.throws(() => {
      db.prepare("DELETE FROM definitions WHERE id = ?").run(def.id);
    }, /cannot be deleted/);
    const event: TaskEvent = {
      kind: "completed",
      task: def.id,
      window: "2026-08-25" as LocalDate,
      by: "dad" as MemberId,
      at: "2026-08-25T12:00:00Z" as Instant,
    };
    applyEvent(event);
    assert.throws(() => {
      db.prepare("UPDATE events SET by = ? WHERE task = ?").run(
        "ellie",
        def.id,
      );
    }, /append-only/);
    assert.throws(() => {
      db.prepare("DELETE FROM events WHERE task = ?").run(def.id);
    }, /append-only/);
    db.prepare(
      `INSERT INTO star_adjustments (id, member, delta, reason, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("adj-1", "dad", 1, null, "2026-08-25T12:00:00Z");
    assert.throws(() => {
      db.prepare("UPDATE star_adjustments SET delta = 2 WHERE id = ?").run(
        "adj-1",
      );
    }, /append-only/);
    assert.throws(() => {
      db.prepare("DELETE FROM star_adjustments WHERE id = ?").run("adj-1");
    }, /append-only/);
  });

  test("reads append-only star adjustments", () => {
    tasksDatabase()
      .prepare(
        `INSERT INTO star_adjustments (id, member, delta, reason, at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("adj-read", "ellie", -3, "Reward", "2026-08-25T12:00:00Z");
    assert.deepEqual(
      loadStarAdjustments().find((adjustment) => adjustment.id === "adj-read"),
      {
        id: "adj-read",
        member: "ellie",
        delta: -3,
        reason: "Reward",
        at: "2026-08-25T12:00:00Z",
      },
    );
  });
});
