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
  tasksDatabase,
} from "./store";
import type {
  Instant,
  LineageId,
  LocalDate,
  TaskDefinition,
  TaskEvent,
  TaskId,
} from "./types";

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

  test("all three tables exist and user_version is 1", () => {
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
    assert.equal(version.user_version, 1);
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
    }, /immutable except retiredAt/);
    assert.throws(() => {
      db.prepare("UPDATE definitions SET title = ? WHERE id = ?").run(
        "Trash",
        def.id,
      );
    }, /immutable except retiredAt/);
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
