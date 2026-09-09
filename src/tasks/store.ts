import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "@/shared/data-path";
import {
  type CreateTaskDraft,
  type EventReceipt,
  isRecord,
  type LocalDate,
  newTaskId,
  parseAssignment,
  parseInstant,
  parseLineageId,
  parseLocalDate,
  parseLocalTime,
  parseRecurrence,
  parseTaskEvent,
  parseTaskId,
  parseTaskType,
  planDefinitionSave,
  type StarAdjustment,
  type TaskDefinition,
  type TaskEvent,
  type TaskId,
} from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS definitions (
  creation_order INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  lineage TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('chore', 'routine')),
  recurrence TEXT NOT NULL,
  assignment TEXT NOT NULL,
  time TEXT,
  stars INTEGER NOT NULL CHECK (stars >= 0),
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  task TEXT NOT NULL,
  window TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('completed', 'verified', 'claimed', 'skipped')),
  by TEXT,
  at TEXT,
  reason TEXT,
  PRIMARY KEY (task, window, kind)
);

CREATE TABLE IF NOT EXISTS star_adjustments (
  id TEXT NOT NULL PRIMARY KEY,
  member TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS events_verified_requires_completed
BEFORE INSERT ON events
WHEN NEW.kind = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified requires completed')
  WHERE NOT EXISTS (
    SELECT 1 FROM events
    WHERE task = NEW.task AND window = NEW.window AND kind = 'completed'
  );
END;

CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS star_adjustments_no_update
BEFORE UPDATE ON star_adjustments
BEGIN
  SELECT RAISE(ABORT, 'star_adjustments are append-only');
END;

CREATE TRIGGER IF NOT EXISTS star_adjustments_no_delete
BEFORE DELETE ON star_adjustments
BEGIN
  SELECT RAISE(ABORT, 'star_adjustments are append-only');
END;

CREATE TRIGGER IF NOT EXISTS definitions_no_delete
BEFORE DELETE ON definitions
BEGIN
  SELECT RAISE(ABORT, 'definitions cannot be deleted');
END;

DROP TRIGGER IF EXISTS definitions_retired_once;
DROP TRIGGER IF EXISTS definitions_update_guard;
CREATE TRIGGER IF NOT EXISTS definitions_update_guard
BEFORE UPDATE ON definitions
BEGIN
  SELECT RAISE(ABORT, 'id, lineage, recurrence, and assignment are immutable')
  WHERE
    NEW.creation_order IS NOT OLD.creation_order
    OR NEW.id IS NOT OLD.id
    OR NEW.lineage IS NOT OLD.lineage
    OR NEW.recurrence IS NOT OLD.recurrence
    OR NEW.assignment IS NOT OLD.assignment;
  SELECT RAISE(ABORT, 'retired definition is frozen')
  WHERE OLD.retired_at IS NOT NULL;
  SELECT RAISE(ABORT, 'retire must not change details')
  WHERE NEW.retired_at IS NOT NULL
    AND (
      NEW.title IS NOT OLD.title
      OR NEW.type IS NOT OLD.type
      OR NEW.time IS NOT OLD.time
      OR NEW.stars IS NOT OLD.stars
    );
END;

PRAGMA user_version = 2;
`;

type Cached = { dir: string; db: DatabaseSync };

let cached: Cached | null = null;

export function tasksDatabase(): DatabaseSync {
  const dir = dataDir();
  if (cached?.dir === dir) return cached.db;
  cached?.db.close();
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "tasks.sqlite"));
  db.exec(SCHEMA);
  cached = { dir, db };
  return db;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function definitionFromRow(row: Record<string, unknown>): TaskDefinition {
  const id = parseTaskId(row.id);
  const lineage = parseLineageId(row.lineage);
  const title = typeof row.title === "string" ? row.title : "";
  const type = parseTaskType(row.type);
  const recurrence = parseRecurrence(parseJson(row.recurrence));
  const assignment = parseAssignment(parseJson(row.assignment));
  const time =
    row.time === null || row.time === undefined
      ? null
      : parseLocalTime(row.time);
  const stars = row.stars;
  const retiredAt =
    row.retired_at === null || row.retired_at === undefined
      ? null
      : parseLocalDate(row.retired_at);
  if (
    !id ||
    !lineage ||
    !title ||
    !type ||
    !recurrence ||
    !assignment ||
    typeof stars !== "number" ||
    !Number.isInteger(stars) ||
    stars < 0 ||
    (row.time != null && !time) ||
    (row.retired_at != null && !retiredAt)
  ) {
    throw new Error("corrupt task definition row");
  }
  return {
    id,
    lineage,
    title,
    type,
    recurrence,
    assignment,
    time,
    stars,
    retiredAt,
  };
}

function eventFromRow(row: Record<string, unknown>): TaskEvent {
  const parsed = parseTaskEvent({
    kind: row.kind,
    task: row.task,
    window: row.window,
    by: row.by,
    at: row.at,
    reason: row.reason,
  });
  if (!parsed) throw new Error("corrupt task event row");
  return parsed;
}

function adjustmentFromRow(row: Record<string, unknown>): StarAdjustment {
  const id = typeof row.id === "string" && row.id ? row.id : null;
  const member =
    typeof row.member === "string" && row.member ? row.member : null;
  const delta = row.delta;
  const reason =
    row.reason === null || typeof row.reason === "string" ? row.reason : null;
  const at = parseInstant(row.at);
  if (
    !id ||
    !member ||
    typeof delta !== "number" ||
    !Number.isInteger(delta) ||
    (row.reason !== null && typeof row.reason !== "string") ||
    !at
  ) {
    throw new Error("corrupt star adjustment row");
  }
  return { id, member, delta, reason, at };
}

export function insertDefinition(definition: TaskDefinition): void {
  tasksDatabase()
    .prepare(
      `INSERT INTO definitions
        (id, lineage, title, type, recurrence, assignment, time, stars, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      definition.id,
      definition.lineage,
      definition.title,
      definition.type,
      JSON.stringify(definition.recurrence),
      JSON.stringify(definition.assignment),
      definition.time,
      definition.stars,
      definition.retiredAt,
    );
}

function definitionById(id: TaskId): TaskDefinition | null {
  const row = tasksDatabase()
    .prepare("SELECT * FROM definitions WHERE id = ?")
    .get(id);
  if (!row) return null;
  if (!isRecord(row)) throw new Error("corrupt task definition row");
  return definitionFromRow(row);
}

function completedCount(id: TaskId): number {
  const row = tasksDatabase()
    .prepare(
      "SELECT COUNT(*) AS n FROM events WHERE task = ? AND kind = 'completed'",
    )
    .get(id);
  return isRecord(row) && typeof row.n === "number" ? row.n : 0;
}

export function saveDefinition(input: {
  id: TaskId;
  draft: CreateTaskDraft;
  today: LocalDate;
}): TaskDefinition {
  const current = definitionById(input.id);
  if (!current || current.retiredAt !== null) {
    throw new Error("task not found");
  }
  const plan = planDefinitionSave({
    current,
    draft: input.draft,
    today: input.today,
    nextId: newTaskId(),
    completedCount: completedCount(current.id),
  });
  const db = tasksDatabase();
  if (plan.kind === "in-place") {
    db.prepare(
      `UPDATE definitions SET title = ?, type = ?, time = ?, stars = ? WHERE id = ?`,
    ).run(plan.title, plan.type, plan.time, plan.stars, current.id);
    const saved = definitionById(current.id);
    if (!saved) throw new Error("task not found");
    return saved;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE definitions SET retired_at = ? WHERE id = ?").run(
      plan.retiredAt,
      current.id,
    );
    insertDefinition(plan.replacement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return plan.replacement;
}

export function loadDefinitions(): TaskDefinition[] {
  const rows = tasksDatabase()
    .prepare("SELECT * FROM definitions ORDER BY creation_order")
    .all();
  return rows.map((row) => {
    if (!isRecord(row)) throw new Error("corrupt task definition row");
    return definitionFromRow(row);
  });
}

export function loadEvents(): TaskEvent[] {
  const rows = tasksDatabase()
    .prepare("SELECT task, window, kind, by, at, reason FROM events")
    .all();
  return rows.map((row) => {
    if (!isRecord(row)) throw new Error("corrupt task event row");
    return eventFromRow(row);
  });
}

export function loadStarAdjustments(): StarAdjustment[] {
  const rows = tasksDatabase()
    .prepare(
      "SELECT id, member, delta, reason, at FROM star_adjustments ORDER BY rowid",
    )
    .all();
  return rows.map((row) => {
    if (!isRecord(row)) throw new Error("corrupt star adjustment row");
    return adjustmentFromRow(row);
  });
}

function bindEvent(event: TaskEvent): {
  by: string | null;
  at: string | null;
  reason: string | null;
} {
  switch (event.kind) {
    case "completed":
    case "verified":
      return { by: event.by, at: event.at, reason: null };
    case "claimed":
      return { by: event.by, at: null, reason: null };
    case "skipped":
      return { by: null, at: null, reason: event.reason };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function isSqliteError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code: unknown }).code === "ERR_SQLITE_ERROR"
  );
}

export function applyEvent(event: TaskEvent): EventReceipt {
  const base = { task: event.task, window: event.window, kind: event.kind };
  const bound = bindEvent(event);
  try {
    const result = tasksDatabase()
      .prepare(
        `INSERT INTO events (task, window, kind, by, at, reason)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(
        event.task,
        event.window,
        event.kind,
        bound.by,
        bound.at,
        bound.reason,
      );
    return result.changes === 0
      ? { ...base, status: "already-present" }
      : { ...base, status: "inserted" };
  } catch (error) {
    if (
      isSqliteError(error) &&
      error.message.includes("verified requires completed")
    ) {
      return {
        ...base,
        status: "rejected",
        error: "verified requires completed",
      };
    }
    throw error;
  }
}

export function loadStore(): {
  definitions: TaskDefinition[];
  events: TaskEvent[];
  adjustments: StarAdjustment[];
} {
  return {
    definitions: loadDefinitions(),
    events: loadEvents(),
    adjustments: loadStarAdjustments(),
  };
}
