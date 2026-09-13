import { DatabaseSync } from "node:sqlite";
import type { HouseholdMember } from "@/members/members";
import { migrateTaskAdministration } from "./store-migration";
import {
  type LegacyTaskDefinition,
  type LocalDate,
  parseAssignment,
  parseInstant,
  parseLineageId,
  parseLocalDate,
  parseLocalTime,
  parseRecurrence,
  parseTaskEvent,
  parseTaskId,
  parseTaskType,
  type TaskEvent,
} from "./types";

const LEGACY_V1_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE definitions (
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
  CREATE TABLE events (
    task TEXT NOT NULL,
    window TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('completed', 'verified', 'claimed', 'skipped')),
    by TEXT,
    at TEXT,
    reason TEXT,
    PRIMARY KEY (task, window, kind)
  );
  CREATE TABLE star_adjustments (
    id TEXT NOT NULL PRIMARY KEY,
    member TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT,
    at TEXT NOT NULL
  );
  CREATE TRIGGER events_verified_requires_completed
  BEFORE INSERT ON events WHEN NEW.kind = 'verified'
  BEGIN
    SELECT RAISE(ABORT, 'verified requires completed') WHERE NOT EXISTS (
      SELECT 1 FROM events
      WHERE task = NEW.task AND window = NEW.window AND kind = 'completed'
    );
  END;
  CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  CREATE TRIGGER star_adjustments_no_update BEFORE UPDATE ON star_adjustments
    BEGIN SELECT RAISE(ABORT, 'star_adjustments are append-only'); END;
  CREATE TRIGGER star_adjustments_no_delete BEFORE DELETE ON star_adjustments
    BEGIN SELECT RAISE(ABORT, 'star_adjustments are append-only'); END;
  CREATE TRIGGER definitions_no_delete BEFORE DELETE ON definitions
    BEGIN SELECT RAISE(ABORT, 'definitions cannot be deleted'); END;
  CREATE TRIGGER definitions_update_guard BEFORE UPDATE ON definitions
  BEGIN
    SELECT RAISE(ABORT, 'id, lineage, recurrence, and assignment are immutable')
    WHERE NEW.creation_order IS NOT OLD.creation_order
      OR NEW.id IS NOT OLD.id OR NEW.lineage IS NOT OLD.lineage
      OR NEW.recurrence IS NOT OLD.recurrence
      OR NEW.assignment IS NOT OLD.assignment;
    SELECT RAISE(ABORT, 'retired definition is frozen')
      WHERE OLD.retired_at IS NOT NULL;
    SELECT RAISE(ABORT, 'retire must not change details')
      WHERE NEW.retired_at IS NOT NULL AND (
        NEW.title IS NOT OLD.title OR NEW.type IS NOT OLD.type
        OR NEW.time IS NOT OLD.time OR NEW.stars IS NOT OLD.stars
      );
  END;
  PRAGMA user_version = 1;
`;

type LegacyDefinitionSeed = Readonly<{
  id: string;
  title: string;
  type: "chore" | "routine";
  recurrence: object;
  assignment:
    | Readonly<{ kind: "open" }>
    | Readonly<{ kind: "fixed"; member: string }>
    | Readonly<{ kind: "rotation"; order: readonly string[] }>;
  time?: string;
  stars: number;
  retiredAt?: string;
}>;

const DEFINITIONS: readonly LegacyDefinitionSeed[] = [
  {
    id: "legacy-once-open",
    title: "Put away delivery",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-14" },
    assignment: { kind: "open" },
    stars: 2,
  },
  {
    id: "legacy-once-expired",
    title: "Return library books",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-10" },
    assignment: { kind: "open" },
    stars: 3,
  },
  {
    id: "legacy-once-skipped",
    title: "Sort donation box",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-11" },
    assignment: { kind: "open" },
    stars: 1,
  },
  {
    id: "legacy-once-completed",
    title: "Wash guest sheets",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-09" },
    assignment: { kind: "open" },
    stars: 7,
  },
  {
    id: "legacy-once-retired",
    title: "Discard old paint",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-14" },
    assignment: { kind: "open" },
    stars: 4,
    retiredAt: "2026-09-12",
  },
  {
    id: "legacy-routine-open",
    title: "Check air filter",
    type: "routine",
    recurrence: { kind: "daily" },
    assignment: { kind: "open" },
    time: "08:00",
    stars: 5,
  },
  {
    id: "legacy-recurring-old-claim",
    title: "Sweep porch",
    type: "chore",
    recurrence: { kind: "weekly", days: ["sun", "mon"] },
    assignment: { kind: "open" },
    stars: 6,
  },
  {
    id: "legacy-recurring-current-claim",
    title: "Water garden",
    type: "chore",
    recurrence: { kind: "weekly", days: ["sun", "mon"] },
    assignment: { kind: "open" },
    stars: 6,
  },
  {
    id: "legacy-recurring-retired-claim",
    title: "Fill bird feeder",
    type: "chore",
    recurrence: { kind: "weekly", days: ["sun", "mon"] },
    assignment: { kind: "open" },
    stars: 2,
  },
  {
    id: "legacy-once-retired-member-claim",
    title: "Carry boxes",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-14" },
    assignment: { kind: "open" },
    stars: 8,
  },
  {
    id: "legacy-completed-missing-credit",
    title: "Old completion",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-08" },
    assignment: { kind: "open" },
    stars: 9,
  },
  {
    id: "legacy-completed-zero-credit",
    title: "Free favor",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-07" },
    assignment: { kind: "open" },
    stars: 0,
  },
  {
    id: "legacy-completed-reassigned",
    title: "Clean garage",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-06" },
    assignment: { kind: "open" },
    stars: 5,
  },
  {
    id: "legacy-undone-recorded-claim",
    title: "Polish table",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-05" },
    assignment: { kind: "open" },
    stars: 3,
  },
  {
    id: "legacy-undone-without-claim",
    title: "Clean cupboard",
    type: "chore",
    recurrence: { kind: "once", date: "2026-09-04" },
    assignment: { kind: "open" },
    stars: 10,
  },
  {
    id: "legacy-fixed-task",
    title: "Dad medicine",
    type: "chore",
    recurrence: { kind: "daily" },
    assignment: { kind: "fixed", member: "dad" },
    time: "07:00",
    stars: 2,
  },
  {
    id: "legacy-rotation-task",
    title: "Kitchen close",
    type: "routine",
    recurrence: { kind: "weekly", days: ["mon"] },
    assignment: { kind: "rotation", order: ["dad", "kid"] },
    time: "20:00",
    stars: 2,
  },
];

export const LEGACY_BOUNTY_V2_EXPECTED = {
  today: "2026-09-14",
  members: [
    { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
    { id: "kid", name: "Kid", status: "active", color: "#f6c9c5" },
    { id: "former", name: "Former", status: "retired" },
  ] satisfies HouseholdMember[],
  preserveAssigned: ["legacy-fixed-task", "legacy-rotation-task"],
  convertToBounty: DEFINITIONS.filter(
    (definition) => definition.assignment.kind === "open",
  ).map((definition) => definition.id),
  availableOnce: [
    "legacy-once-open",
    "legacy-once-expired",
    "legacy-once-skipped",
    "legacy-once-retired-member-claim",
    "legacy-undone-without-claim",
  ],
  currentRecurringOfferings: [
    "legacy-recurring-old-claim",
    "legacy-recurring-retired-claim",
    "legacy-routine-open",
  ],
  unfinishedClaims: [
    {
      source: "legacy-recurring-old-claim",
      window: "2026-09-13",
      member: "dad",
    },
    {
      source: "legacy-recurring-current-claim",
      window: "2026-09-14",
      member: "kid",
    },
    {
      source: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      member: "dad",
    },
  ],
  releasedClaims: [
    {
      source: "legacy-recurring-retired-claim",
      window: "2026-09-13",
      member: "former",
    },
    {
      source: "legacy-once-retired-member-claim",
      window: "2026-09-14",
      member: "former",
    },
  ],
  noNewOffering: ["legacy-once-completed", "legacy-once-retired"],
  completionCredits: [
    {
      source: "legacy-once-completed",
      window: "2026-09-09",
      stars: 7,
      effectiveBy: "dad",
    },
    {
      source: "legacy-completed-zero-credit",
      window: "2026-09-07",
      stars: 0,
      effectiveBy: "dad",
    },
    {
      source: "legacy-completed-reassigned",
      window: "2026-09-06",
      stars: 5,
      effectiveBy: "kid",
    },
    {
      source: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      stars: 3,
      effectiveBy: null,
    },
  ],
  missingCompletionCredits: [
    { source: "legacy-completed-missing-credit", window: "2026-09-08" },
    { source: "legacy-undone-without-claim", window: "2026-09-04" },
  ],
  reopenedFromUndo: [
    {
      source: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      recordedClaimant: "dad",
      outcome: "unfinished-claim",
    },
    {
      source: "legacy-undone-without-claim",
      window: "2026-09-04",
      recordedClaimant: null,
      outcome: "available-once",
    },
  ],
  recurringStartsOn: {
    "legacy-routine-open": "2026-09-14",
    "legacy-recurring-old-claim": "2026-09-13",
    "legacy-recurring-current-claim": "2026-09-14",
    "legacy-recurring-retired-claim": "2026-09-13",
  },
  correctionOrder: [
    "correction-reassign-to-kid",
    "correction-recorded-claim-to-kid",
    "correction-undo-recorded-claim",
    "correction-undo-without-claim",
  ],
  balances: { dad: 9, kid: 5 },
} as const;

function insertDefinition(db: DatabaseSync, definition: LegacyDefinitionSeed) {
  db.prepare(
    `INSERT INTO definitions
      (id, lineage, title, type, recurrence, assignment, time, stars, retired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    definition.id,
    `lineage:${definition.id}`,
    definition.title,
    definition.type,
    JSON.stringify(definition.recurrence),
    JSON.stringify(definition.assignment),
    definition.time ?? null,
    definition.stars,
    definition.retiredAt ?? null,
  );
}

function insertEvent(
  db: DatabaseSync,
  event: {
    task: string;
    window: string;
    kind: "claimed" | "skipped" | "completed" | "verified";
    by?: string;
    at?: string;
    reason?: string;
  },
) {
  db.prepare(
    "INSERT INTO events (task, window, kind, by, at, reason) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    event.task,
    event.window,
    event.kind,
    event.by ?? null,
    event.at ?? null,
    event.reason ?? null,
  );
}

function insertCorrection(
  db: DatabaseSync,
  correction: {
    id: string;
    task: string;
    window: string;
    by: string | null;
    reason: string;
    at: string;
    previous?: string;
  },
) {
  db.prepare(
    `INSERT INTO completion_corrections
      (id, task, window, by, reason, at, previous)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    correction.id,
    correction.task,
    correction.window,
    correction.by,
    correction.reason,
    correction.at,
    correction.previous ?? null,
  );
}

export function createLegacyBountyV2Fixture(
  databasePath = ":memory:",
): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(LEGACY_V1_SCHEMA);
    for (const definition of DEFINITIONS) insertDefinition(db, definition);

    // These completions predate ADR 0007, so the v2 migration intentionally
    // leaves them without completion-credit rows or balance changes.
    insertEvent(db, {
      task: "legacy-completed-missing-credit",
      window: "2026-09-08",
      kind: "completed",
      by: "kid",
      at: "2026-09-08T15:00:00Z",
    });
    insertEvent(db, {
      task: "legacy-undone-without-claim",
      window: "2026-09-04",
      kind: "completed",
      by: "kid",
      at: "2026-09-04T15:00:00Z",
    });

    migrateTaskAdministration(db);

    insertEvent(db, {
      task: "legacy-once-skipped",
      window: "2026-09-11",
      kind: "skipped",
      reason: "Away",
    });
    insertEvent(db, {
      task: "legacy-recurring-old-claim",
      window: "2026-09-13",
      kind: "claimed",
      by: "dad",
    });
    insertEvent(db, {
      task: "legacy-recurring-current-claim",
      window: "2026-09-14",
      kind: "claimed",
      by: "kid",
    });
    insertEvent(db, {
      task: "legacy-recurring-retired-claim",
      window: "2026-09-13",
      kind: "claimed",
      by: "former",
    });
    insertEvent(db, {
      task: "legacy-once-retired-member-claim",
      window: "2026-09-14",
      kind: "claimed",
      by: "former",
    });
    insertEvent(db, {
      task: "legacy-once-completed",
      window: "2026-09-09",
      kind: "completed",
      by: "dad",
      at: "2026-09-09T15:00:00Z",
    });
    insertEvent(db, {
      task: "legacy-once-completed",
      window: "2026-09-09",
      kind: "verified",
      by: "dad",
      at: "2026-09-09T15:05:00Z",
    });
    insertEvent(db, {
      task: "legacy-completed-zero-credit",
      window: "2026-09-07",
      kind: "completed",
      by: "dad",
      at: "2026-09-07T15:00:00Z",
    });
    insertEvent(db, {
      task: "legacy-completed-reassigned",
      window: "2026-09-06",
      kind: "completed",
      by: "dad",
      at: "2026-09-06T15:00:00Z",
    });
    insertCorrection(db, {
      id: "correction-reassign-to-kid",
      task: "legacy-completed-reassigned",
      window: "2026-09-06",
      by: "kid",
      reason: "Kid did the work",
      at: "2026-09-06T16:00:00Z",
    });
    db.exec(
      "UPDATE star_balances SET balance = balance - 5 WHERE member = 'dad'",
    );
    db.exec(
      "INSERT INTO star_balances (member, balance) VALUES ('kid', 5) ON CONFLICT(member) DO UPDATE SET balance = balance + 5",
    );

    insertEvent(db, {
      task: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      kind: "claimed",
      by: "dad",
    });
    insertEvent(db, {
      task: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      kind: "completed",
      by: "dad",
      at: "2026-09-05T15:00:00Z",
    });
    insertCorrection(db, {
      id: "correction-recorded-claim-to-kid",
      task: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      by: "kid",
      reason: "Kid initially received credit",
      at: "2026-09-05T15:30:00Z",
    });
    db.exec(
      "UPDATE star_balances SET balance = balance - 3 WHERE member = 'dad'",
    );
    db.exec(
      "UPDATE star_balances SET balance = balance + 3 WHERE member = 'kid'",
    );
    insertCorrection(db, {
      id: "correction-undo-recorded-claim",
      task: "legacy-undone-recorded-claim",
      window: "2026-09-05",
      by: null,
      reason: "Marked done by mistake",
      at: "2026-09-05T16:00:00Z",
      previous: "correction-recorded-claim-to-kid",
    });
    db.exec(
      "UPDATE star_balances SET balance = balance - 3 WHERE member = 'kid'",
    );
    insertCorrection(db, {
      id: "correction-undo-without-claim",
      task: "legacy-undone-without-claim",
      window: "2026-09-04",
      by: null,
      reason: "Historical mistake",
      at: "2026-09-04T16:00:00Z",
    });
    db.prepare(
      "INSERT INTO star_adjustments (id, member, delta, reason, at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "legacy-adjustment-dad",
      "dad",
      2,
      "Existing household adjustment",
      "2026-09-12T12:00:00Z",
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readLegacyBountyV2Fixture(db: DatabaseSync): {
  definitions: LegacyTaskDefinition[];
  events: TaskEvent[];
} {
  const definitions = db
    .prepare("SELECT * FROM definitions ORDER BY creation_order")
    .all()
    .map((row): LegacyTaskDefinition => {
      const id = parseTaskId(row.id);
      const lineage = parseLineageId(row.lineage);
      const type = parseTaskType(row.type);
      const recurrence = parseRecurrence(parseJson(row.recurrence));
      const assignment = parseAssignment(parseJson(row.assignment));
      const time = row.time === null ? null : parseLocalTime(row.time);
      const retiredAt =
        row.retired_at === null ? null : parseLocalDate(row.retired_at);
      if (
        !id ||
        !lineage ||
        !type ||
        !recurrence ||
        !assignment ||
        (row.time !== null && !time) ||
        (row.retired_at !== null && !retiredAt) ||
        typeof row.title !== "string" ||
        !row.title ||
        typeof row.stars !== "number" ||
        !Number.isInteger(row.stars) ||
        row.stars < 0
      ) {
        throw new Error("Invalid legacy definition fixture row");
      }
      return {
        id,
        lineage,
        title: row.title,
        type,
        recurrence,
        assignment,
        time,
        stars: row.stars,
        retiredAt,
      };
    });
  const events = db
    .prepare("SELECT task, window, kind, by, at, reason FROM events")
    .all()
    .map((row): TaskEvent => {
      const event = parseTaskEvent({
        kind: row.kind,
        task: row.task,
        window: row.window,
        by: row.by,
        at: row.at,
        reason: row.reason,
      });
      if (!event) throw new Error("Invalid legacy event fixture row");
      return event;
    });
  for (const row of db.prepare("SELECT * FROM completion_corrections").all()) {
    if (
      !parseTaskId(row.task) ||
      !parseLocalDate(row.window) ||
      !parseInstant(row.at) ||
      typeof row.id !== "string" ||
      typeof row.reason !== "string" ||
      (row.by !== null && typeof row.by !== "string") ||
      (row.previous !== null && typeof row.previous !== "string")
    ) {
      throw new Error("Invalid legacy correction fixture row");
    }
  }
  for (const row of db.prepare("SELECT * FROM completion_credits").all()) {
    if (
      !parseTaskId(row.task) ||
      !parseLocalDate(row.window) ||
      typeof row.stars !== "number" ||
      !Number.isSafeInteger(row.stars) ||
      row.stars < 0
    ) {
      throw new Error("Invalid legacy completion credit fixture row");
    }
  }
  for (const row of db.prepare("SELECT * FROM star_balances").all()) {
    if (
      typeof row.member !== "string" ||
      !row.member ||
      typeof row.balance !== "number" ||
      !Number.isSafeInteger(row.balance) ||
      row.balance < 0
    ) {
      throw new Error("Invalid legacy balance fixture row");
    }
  }
  return { definitions, events };
}

export function validateLegacyBountyV2Fixture(db: DatabaseSync): void {
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (version !== 2 || integrity !== "ok" || foreignKeys.length !== 0) {
    throw new Error("Invalid legacy version-two SQLite fixture");
  }
  readLegacyBountyV2Fixture(db);
}

export function legacyFixtureToday(): LocalDate {
  const today = parseLocalDate(LEGACY_BOUNTY_V2_EXPECTED.today);
  if (!today) throw new Error("Invalid fixture date");
  return today;
}
