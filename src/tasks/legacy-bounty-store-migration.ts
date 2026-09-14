import type { DatabaseSync } from "node:sqlite";
import type { HouseholdMember } from "@/members/members";
import type { CompletionCorrection } from "./admin-types";
import {
  type BountyRecurrence,
  currentBountyInterval,
} from "./bounty-calendar";
import { releaseBountiesForRetiredMembers } from "./bounty-store";
import {
  legacyBountySchedule,
  legacyIntervalStart,
} from "./legacy-bounty-migration";
import {
  type LegacyTaskDefinition,
  type LocalDate,
  parseAssignment,
  parseInstant,
  parseLineageId,
  parseLocalDate,
  parseLocalTime,
  parseRecurrence,
  parseStarAmount,
  parseTaskEvent,
  parseTaskId,
  parseTaskType,
  type TaskEvent,
} from "./types";

const MIGRATION = "legacy-open-work-to-bounties-v1";

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function legacyDefinition(row: Record<string, unknown>): LegacyTaskDefinition {
  const id = parseTaskId(row.id);
  const lineage = parseLineageId(row.lineage);
  const type = parseTaskType(row.type);
  const recurrence = parseRecurrence(parseJson(row.recurrence));
  const assignment = parseAssignment(parseJson(row.assignment));
  const time = row.time === null ? null : parseLocalTime(row.time);
  const retiredAt =
    row.retired_at === null ? null : parseLocalDate(row.retired_at);
  const stars = parseStarAmount(row.stars);
  if (
    !id ||
    !lineage ||
    !type ||
    !recurrence ||
    !assignment ||
    (row.time !== null && !time) ||
    (row.retired_at !== null && !retiredAt) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    stars === null
  ) {
    throw new Error("Invalid legacy open Task definition");
  }
  return {
    id,
    lineage,
    title: row.title,
    type,
    recurrence,
    assignment,
    time,
    stars,
    retiredAt,
  };
}

function eventRows(db: DatabaseSync, task: string): TaskEvent[] {
  return db
    .prepare(
      "SELECT task, window, kind, by, at, reason FROM events WHERE task = ? ORDER BY window, rowid",
    )
    .all(task)
    .map((row) => {
      const event = parseTaskEvent({
        task: row.task,
        window: row.window,
        kind: row.kind,
        by: row.by,
        at: row.at,
        reason: row.reason,
      });
      if (!event) throw new Error("Invalid legacy open Task event");
      return event;
    });
}

function correctionRows(
  db: DatabaseSync,
  task: string,
  window: LocalDate,
): CompletionCorrection[] {
  return db
    .prepare(
      `SELECT id, task, window, by, reason, at, previous
       FROM completion_corrections
       WHERE task = ? AND window = ? ORDER BY sequence`,
    )
    .all(task, window)
    .map((row) => {
      const date = parseLocalDate(row.window);
      const at = parseInstant(row.at);
      const taskId = parseTaskId(row.task);
      if (
        typeof row.id !== "string" ||
        !row.id ||
        !taskId ||
        !date ||
        (row.by !== null && (typeof row.by !== "string" || !row.by)) ||
        typeof row.reason !== "string" ||
        !row.reason.trim() ||
        !at ||
        (row.previous !== null && typeof row.previous !== "string")
      ) {
        throw new Error("Invalid legacy completion correction");
      }
      return {
        id: row.id,
        task: taskId,
        window: date,
        by: row.by,
        reason: row.reason,
        at,
        previous: row.previous,
      };
    });
}

function compatibilityInterval(
  recurrence: BountyRecurrence,
  window: LocalDate,
): LocalDate | null {
  return recurrence.kind === "once"
    ? null
    : legacyIntervalStart(recurrence.cadence, window);
}

function insertCanonicalOffering(
  db: DatabaseSync,
  definition: LegacyTaskDefinition,
  recurrence: BountyRecurrence,
  today: LocalDate,
): void {
  if (definition.retiredAt !== null) return;
  if (recurrence.kind === "once") {
    db.prepare(
      `INSERT INTO bounty_offerings
        (id, definition_id, kind, interval_start, source_window)
       VALUES (?, ?, 'once', NULL, NULL)`,
    ).run(`legacy-canonical:${definition.id}:once`, definition.id);
    return;
  }
  const interval = currentBountyInterval(recurrence, today);
  if (!interval) return;
  db.prepare(
    `INSERT INTO bounty_offerings
      (id, definition_id, kind, interval_start, source_window)
     VALUES (?, ?, 'recurring', ?, NULL)`,
  ).run(
    `legacy-canonical:${definition.id}:${interval.start}`,
    definition.id,
    interval.start,
  );
}

function insertCompatibilityOffering(
  db: DatabaseSync,
  definition: LegacyTaskDefinition,
  recurrence: BountyRecurrence,
  window: LocalDate,
): string {
  const id = `legacy-offering:${definition.id}:${window}`;
  db.prepare(
    `INSERT INTO bounty_offerings
      (id, definition_id, kind, interval_start, source_window)
     VALUES (?, ?, 'legacy', ?, ?)`,
  ).run(id, definition.id, compatibilityInterval(recurrence, window), window);
  return id;
}

function importedCredit(
  db: DatabaseSync,
  task: string,
  window: LocalDate,
): { stars: number; provenance: "recorded" | "legacy-missing" } {
  const row = db
    .prepare(
      "SELECT stars FROM completion_credits WHERE task = ? AND window = ?",
    )
    .get(task, window);
  if (!row) return { stars: 0, provenance: "legacy-missing" };
  const stars = parseStarAmount(row.stars);
  if (stars === null) throw new Error("Invalid legacy completion credit");
  return { stars, provenance: "recorded" };
}

function insertImportedHistory(input: {
  db: DatabaseSync;
  definition: LegacyTaskDefinition;
  recurrence: BountyRecurrence;
  window: LocalDate;
  claim: Extract<TaskEvent, { kind: "claimed" }> | undefined;
  completion: Extract<TaskEvent, { kind: "completed" }>;
}): void {
  const { db, definition, recurrence, window, claim, completion } = input;
  const offering = insertCompatibilityOffering(
    db,
    definition,
    recurrence,
    window,
  );
  const subject = `${claim ? "legacy-claim" : "legacy-carrier"}:${definition.id}:${window}`;
  db.prepare("INSERT INTO bounty_work_subjects (id, kind) VALUES (?, ?)").run(
    subject,
    claim ? "accepted-claim" : "legacy-completion-carrier",
  );
  const credit = importedCredit(db, definition.id, window);
  const completionId = `legacy-completion:${definition.id}:${window}`;
  let effectiveMember: string | null = completion.by;
  let predecessor: string | null = null;
  const corrections = correctionRows(db, definition.id, window);
  for (const legacy of corrections) {
    if (legacy.previous !== predecessor)
      throw new Error("Broken legacy completion correction chain");
    if (legacy.by !== null && legacy.by === effectiveMember)
      throw new Error("Legacy completion correction does not change creditor");
    effectiveMember = legacy.by;
    predecessor = legacy.id;
  }

  if (claim) {
    if (!claim.by) throw new Error("Invalid legacy claimant");
    const state = effectiveMember === null ? "reopened" : "completed";
    db.prepare(
      `INSERT INTO bounty_claims
        (id, offering_id, definition_id, member, scheduled_on, title, stars,
         revision, state, effective_completion_id, restorable_completion_id,
         correction_id, acceptance_provenance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy', NULL)`,
    ).run(
      subject,
      offering,
      definition.id,
      claim.by,
      window,
      definition.title,
      definition.stars,
      1 + corrections.length,
      state,
      effectiveMember === null ? null : completionId,
      effectiveMember === null ? completionId : null,
      predecessor,
    );
  } else {
    db.prepare(
      `INSERT INTO legacy_bounty_completion_carriers
        (id, offering_id, definition_id, source_task_id, source_window,
         revision, state, effective_completion_id, correction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      subject,
      offering,
      definition.id,
      definition.id,
      window,
      corrections.length,
      effectiveMember === null ? "released" : "completed",
      effectiveMember === null ? null : completionId,
      predecessor,
    );
  }
  db.prepare(
    `INSERT INTO bounty_completions
      (id, subject_id, request_id, origin, member, completed_at,
       credited_stars, credit_provenance)
     VALUES (?, ?, NULL, 'legacy', ?, ?, ?, ?)`,
  ).run(
    completionId,
    subject,
    completion.by,
    completion.at,
    credit.stars,
    credit.provenance,
  );
  effectiveMember = completion.by;
  predecessor = null;
  for (const legacy of corrections) {
    const kind =
      legacy.by === null
        ? "undo"
        : effectiveMember === null
          ? "restore"
          : "reassign";
    db.prepare(
      `INSERT INTO bounty_completion_corrections
        (id, kind, subject_id, completion_id, predecessor_id, from_member,
         to_member, credited_stars, credit_provenance, reason, corrected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      legacy.id,
      kind,
      subject,
      completionId,
      predecessor,
      effectiveMember,
      legacy.by,
      credit.stars,
      credit.provenance,
      legacy.reason,
      legacy.at,
    );
    effectiveMember = legacy.by;
    predecessor = legacy.id;
  }
}

function insertClaim(input: {
  db: DatabaseSync;
  definition: LegacyTaskDefinition;
  recurrence: BountyRecurrence;
  claim: Extract<TaskEvent, { kind: "claimed" }>;
  state: "unfinished" | "released";
}): void {
  const { db, definition, recurrence, claim, state } = input;
  if (!claim.by) throw new Error("Invalid legacy claimant");
  const offering = insertCompatibilityOffering(
    db,
    definition,
    recurrence,
    claim.window,
  );
  const subject = `legacy-claim:${definition.id}:${claim.window}`;
  db.prepare(
    "INSERT INTO bounty_work_subjects (id, kind) VALUES (?, 'accepted-claim')",
  ).run(subject);
  db.prepare(
    `INSERT INTO bounty_claims
      (id, offering_id, definition_id, member, scheduled_on, title, stars,
       revision, state, effective_completion_id, restorable_completion_id,
       correction_id, acceptance_provenance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'legacy', NULL)`,
  ).run(
    subject,
    offering,
    definition.id,
    claim.by,
    claim.window,
    definition.title,
    definition.stars,
    state === "released" ? 1 : 0,
    state,
  );
}

function importDefinition(
  db: DatabaseSync,
  definition: LegacyTaskDefinition,
  today: LocalDate,
): void {
  if (
    db
      .prepare("SELECT 1 FROM bounty_definitions WHERE id = ?")
      .get(definition.id)
  )
    throw new Error(`Legacy Bounty identity collision: ${definition.id}`);
  const events = eventRows(db, definition.id);
  const representedWindows = [
    ...new Set(
      events
        .filter(
          (event) => event.kind === "claimed" || event.kind === "completed",
        )
        .map((event) => event.window),
    ),
  ];
  const recurrence = legacyBountySchedule(
    definition,
    today,
    representedWindows,
  );
  db.prepare(
    `INSERT INTO bounty_definitions
      (id, lineage, title, type, recurrence, stars, revision, offer_from, retired_at)
     VALUES (?, ?, ?, 'chore', ?, ?, 0, ?, ?)`,
  ).run(
    definition.id,
    definition.lineage,
    definition.title,
    recurrence.kind === "once" ? "once" : JSON.stringify(recurrence),
    definition.stars,
    recurrence.kind === "recurring" ? recurrence.startsOn : null,
    definition.retiredAt,
  );
  db.prepare(
    `INSERT INTO legacy_bounty_sources (source_task_id, bounty_definition_id)
     VALUES (?, ?)`,
  ).run(definition.id, definition.id);
  insertCanonicalOffering(db, definition, recurrence, today);

  for (const window of representedWindows) {
    const claim = events.find(
      (event): event is Extract<TaskEvent, { kind: "claimed" }> =>
        event.window === window && event.kind === "claimed",
    );
    const completion = events.find(
      (event): event is Extract<TaskEvent, { kind: "completed" }> =>
        event.window === window && event.kind === "completed",
    );
    if (completion) {
      insertImportedHistory({
        db,
        definition,
        recurrence,
        window,
        claim,
        completion,
      });
    } else if (claim) {
      insertClaim({
        db,
        definition,
        recurrence,
        claim,
        state: events.some(
          (event) => event.window === window && event.kind === "skipped",
        )
          ? "released"
          : "unfinished",
      });
    }
  }
}

export type LegacyBountyMigrationResult = Readonly<{
  status: "migrated" | "already-migrated";
  definitions: number;
}>;

/**
 * Converts the immutable legacy archive without replaying work or credit writers.
 * The caller supplies the household date; unknown historical acceptance times stay null.
 */
export function migrateLegacyOpenWork(input: {
  db: DatabaseSync;
  today: LocalDate;
  members: readonly HouseholdMember[];
}): LegacyBountyMigrationResult {
  const { db, today, members } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db
        .prepare("SELECT 1 FROM legacy_bounty_migrations WHERE migration = ?")
        .get(MIGRATION)
    ) {
      db.exec("COMMIT");
      return { status: "already-migrated", definitions: 0 };
    }
    const balances = JSON.stringify(
      db
        .prepare("SELECT member, balance FROM star_balances ORDER BY member")
        .all(),
    );
    const definitions = db
      .prepare("SELECT * FROM definitions ORDER BY creation_order")
      .all()
      .map((row) => legacyDefinition(row as Record<string, unknown>))
      .filter((definition) => definition.assignment.kind === "open");
    for (const definition of definitions)
      importDefinition(db, definition, today);
    const activeMembers = new Set(
      members
        .filter((member) => member.status === "active")
        .map((member) => member.id),
    );
    const inactiveImportedClaimants = new Set(
      db
        .prepare(
          `SELECT DISTINCT member FROM bounty_claims
           WHERE acceptance_provenance = 'legacy'
             AND state IN ('unfinished', 'reopened')`,
        )
        .all()
        .map((row) => String(row.member))
        .filter((member) => !activeMembers.has(member)),
    );
    releaseBountiesForRetiredMembers(db, inactiveImportedClaimants);
    const after = JSON.stringify(
      db
        .prepare("SELECT member, balance FROM star_balances ORDER BY member")
        .all(),
    );
    if (after !== balances)
      throw new Error("Legacy Bounty migration changed Star Balances");
    const invalidSubject = db
      .prepare(
        `SELECT s.id FROM bounty_work_subjects s
         LEFT JOIN bounty_claims c ON c.id = s.id
         LEFT JOIN legacy_bounty_completion_carriers carrier ON carrier.id = s.id
         WHERE (s.kind = 'accepted-claim' AND (c.id IS NULL OR carrier.id IS NOT NULL))
            OR (s.kind = 'legacy-completion-carrier'
              AND (carrier.id IS NULL OR c.id IS NOT NULL))
         LIMIT 1`,
      )
      .get();
    if (invalidSubject)
      throw new Error("Legacy Bounty migration left an invalid work subject");
    db.prepare(
      "INSERT INTO legacy_bounty_migrations (migration, completed_at) VALUES (?, ?)",
    ).run(MIGRATION, new Date().toISOString());
    const foreignKeyError = db.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyError)
      throw new Error("Legacy Bounty migration broke a foreign key");
    db.exec("COMMIT");
    return { status: "migrated", definitions: definitions.length };
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
