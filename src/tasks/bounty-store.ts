import type { DatabaseSync } from "node:sqlite";
import type { MemberId } from "@/members/members";
import {
  type AvailableBounty,
  type BountyClaim,
  type BountyCommand,
  type BountyCommandReceipt,
  type BountyCompletion,
  type BountyDefinition,
  type ClaimedBounty,
  type CreateBountyDraft,
  createBountyDefinition,
  isRecord,
  type LegacyTaskDefinition,
  type LocalDate,
  newClaimId,
  newCompletionId,
  newOfferingId,
  nowInstant,
  parseBountyCommandReceipt,
  parseClaimId,
  parseClaimRevision,
  parseCompletionId,
  parseInstant,
  parseLineageId,
  parseLocalDate,
  parseOfferingId,
  parseStarAmount,
  parseTaskId,
  parseTaskTitle,
  type TaskDefinition,
} from "./types";

export class BountyStoreError extends Error {}

export function migrateBountyStore(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  const present = db
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'bounty_definitions'",
    )
    .get();
  if (present) return;
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE bounty_definitions (
      creation_order INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      lineage TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      type TEXT NOT NULL CHECK (type = 'chore'),
      recurrence TEXT NOT NULL CHECK (recurrence = 'once'),
      stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
      retired_at TEXT
    );
    CREATE TABLE bounty_offerings (
      id TEXT NOT NULL PRIMARY KEY,
      definition_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind = 'once'),
      FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
    );
    CREATE TABLE bounty_claims (
      id TEXT NOT NULL PRIMARY KEY,
      offering_id TEXT NOT NULL UNIQUE,
      definition_id TEXT NOT NULL,
      member TEXT NOT NULL,
      scheduled_on TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      state TEXT NOT NULL CHECK (state IN ('unfinished', 'completed')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (offering_id) REFERENCES bounty_offerings(id),
      FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
    );
    CREATE TABLE bounty_completions (
      id TEXT NOT NULL PRIMARY KEY,
      claim_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      member TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      credited_stars INTEGER NOT NULL CHECK (credited_stars >= 0 AND credited_stars <= 9007199254740991),
      FOREIGN KEY (claim_id) REFERENCES bounty_claims(id)
    );
    CREATE TABLE bounty_command_receipts (
      request_id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('claim-bounty', 'complete-bounty')),
      payload TEXT NOT NULL,
      response TEXT NOT NULL
    );
    CREATE TRIGGER bounty_definitions_update_guard BEFORE UPDATE ON bounty_definitions
    BEGIN
      SELECT RAISE(ABORT, 'bounty identity and recurrence are immutable') WHERE
        NEW.creation_order IS NOT OLD.creation_order OR NEW.id IS NOT OLD.id
        OR NEW.lineage IS NOT OLD.lineage OR NEW.type IS NOT OLD.type
        OR NEW.recurrence IS NOT OLD.recurrence;
      SELECT RAISE(ABORT, 'retired Bounty definition is frozen')
        WHERE OLD.retired_at IS NOT NULL;
      SELECT RAISE(ABORT, 'retire must not change Bounty details') WHERE
        NEW.retired_at IS NOT NULL
        AND (NEW.title IS NOT OLD.title OR NEW.stars IS NOT OLD.stars);
    END;
    CREATE TRIGGER bounty_definitions_no_delete BEFORE DELETE ON bounty_definitions
      BEGIN SELECT RAISE(ABORT, 'bounty definitions cannot be deleted'); END;
    CREATE TRIGGER bounty_offerings_no_update BEFORE UPDATE ON bounty_offerings
      BEGIN SELECT RAISE(ABORT, 'bounty offerings are immutable'); END;
    CREATE TRIGGER bounty_offerings_no_delete BEFORE DELETE ON bounty_offerings
      BEGIN SELECT RAISE(ABORT, 'bounty offerings cannot be deleted'); END;
    CREATE TRIGGER bounty_claims_update_guard BEFORE UPDATE ON bounty_claims
    BEGIN
      SELECT RAISE(ABORT, 'bounty claim snapshot is immutable') WHERE
        NEW.id IS NOT OLD.id OR NEW.offering_id IS NOT OLD.offering_id
        OR NEW.definition_id IS NOT OLD.definition_id OR NEW.member IS NOT OLD.member
        OR NEW.scheduled_on IS NOT OLD.scheduled_on OR NEW.title IS NOT OLD.title
        OR NEW.stars IS NOT OLD.stars OR NEW.created_at IS NOT OLD.created_at;
      SELECT RAISE(ABORT, 'invalid bounty claim transition') WHERE
        OLD.state != 'unfinished' OR NEW.state != 'completed'
        OR NEW.revision != OLD.revision + 1;
    END;
    CREATE TRIGGER bounty_claims_no_delete BEFORE DELETE ON bounty_claims
      BEGIN SELECT RAISE(ABORT, 'bounty claims cannot be deleted'); END;
    CREATE TRIGGER bounty_completions_no_update BEFORE UPDATE ON bounty_completions
      BEGIN SELECT RAISE(ABORT, 'bounty completions are immutable'); END;
    CREATE TRIGGER bounty_completions_no_delete BEFORE DELETE ON bounty_completions
      BEGIN SELECT RAISE(ABORT, 'bounty completions are immutable'); END;
    CREATE TRIGGER bounty_receipts_no_update BEFORE UPDATE ON bounty_command_receipts
      BEGIN SELECT RAISE(ABORT, 'bounty receipts are immutable'); END;
    CREATE TRIGGER bounty_receipts_no_delete BEFORE DELETE ON bounty_command_receipts
      BEGIN SELECT RAISE(ABORT, 'bounty receipts are immutable'); END;
    PRAGMA user_version = 3;
    COMMIT;
  `);
}

function bountyDefinitionFromRow(
  row: Record<string, unknown>,
): BountyDefinition {
  const id = parseTaskId(row.id);
  const lineage = parseLineageId(row.lineage);
  const retiredAt =
    row.retired_at === null ? null : parseLocalDate(row.retired_at);
  const title = parseTaskTitle(row.title);
  const stars = parseStarAmount(row.stars);
  if (
    !id ||
    !lineage ||
    !title ||
    row.type !== "chore" ||
    row.recurrence !== "once" ||
    stars === null ||
    (row.retired_at !== null && !retiredAt)
  ) {
    throw new Error("corrupt Bounty definition row");
  }
  return {
    kind: "bounty",
    id,
    lineage,
    title,
    type: "chore",
    stars,
    recurrence: { kind: "once" },
    retiredAt,
  };
}

function claimFromRow(row: Record<string, unknown>): BountyClaim {
  const id = parseClaimId(row.id);
  const definition = parseTaskId(row.definition_id);
  const scheduledOn = parseLocalDate(row.scheduled_on);
  const title = parseTaskTitle(row.title);
  const stars = parseStarAmount(row.stars);
  const revision = parseClaimRevision(row.revision);
  if (
    !id ||
    !definition ||
    !scheduledOn ||
    typeof row.member !== "string" ||
    !row.member ||
    !title ||
    stars === null ||
    revision === null
  ) {
    throw new Error("corrupt Bounty claim row");
  }
  return {
    id,
    offering: { kind: "once", definition },
    member: row.member,
    scheduledOn,
    title,
    stars,
    revision,
  };
}

function completionFromRow(row: Record<string, unknown>): BountyCompletion {
  const id = parseCompletionId(row.id);
  const claim = parseClaimId(row.claim_id);
  const at = parseInstant(row.completed_at);
  const creditedStars = parseStarAmount(row.credited_stars);
  if (
    !id ||
    !claim ||
    !at ||
    typeof row.member !== "string" ||
    !row.member ||
    creditedStars === null
  ) {
    throw new Error("corrupt Bounty completion row");
  }
  return { id, claim, by: row.member, at, creditedStars };
}

export function createBounty(
  db: DatabaseSync,
  draft: CreateBountyDraft,
): BountyDefinition {
  const definition = createBountyDefinition(draft);
  const offering = newOfferingId();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO bounty_definitions
        (id, lineage, title, type, recurrence, stars, retired_at)
       VALUES (?, ?, ?, 'chore', 'once', ?, NULL)`,
    ).run(
      definition.id,
      definition.lineage,
      definition.title,
      definition.stars,
    );
    db.prepare(
      "INSERT INTO bounty_offerings (id, definition_id, kind) VALUES (?, ?, 'once')",
    ).run(offering, definition.id);
    db.exec("COMMIT");
    return definition;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadBountyDefinitions(db: DatabaseSync): BountyDefinition[] {
  return db
    .prepare("SELECT * FROM bounty_definitions ORDER BY creation_order")
    .all()
    .map((row) => {
      if (!isRecord(row)) throw new Error("corrupt Bounty definition row");
      return bountyDefinitionFromRow(row);
    });
}

export function taskDefinitions(
  assigned: readonly LegacyTaskDefinition[],
  bounties: readonly BountyDefinition[],
): TaskDefinition[] {
  return [
    ...assigned.map((definition) => ({
      kind: "assigned" as const,
      ...definition,
    })),
    ...bounties,
  ];
}

export function loadAvailableBounties(db: DatabaseSync): AvailableBounty[] {
  return db
    .prepare(
      `SELECT o.id, o.definition_id, d.title, d.stars
       FROM bounty_offerings o
       JOIN bounty_definitions d ON d.id = o.definition_id
       LEFT JOIN bounty_claims c ON c.offering_id = o.id
       WHERE d.retired_at IS NULL AND c.id IS NULL
       ORDER BY d.creation_order`,
    )
    .all()
    .map((row) => {
      const id = parseOfferingId(row.id);
      const definition = parseTaskId(row.definition_id);
      const title = parseTaskTitle(row.title);
      const stars = parseStarAmount(row.stars);
      if (!id || !definition || !title || stars === null) {
        throw new Error("corrupt Bounty offering row");
      }
      return {
        kind: "available" as const,
        id,
        offering: { kind: "once" as const, definition },
        title,
        stars,
      };
    });
}

export function loadBountyClaims(db: DatabaseSync): ClaimedBounty[] {
  return db
    .prepare(
      `SELECT c.*, x.id AS completion_id, x.completed_at, x.credited_stars
       FROM bounty_claims c
       LEFT JOIN bounty_completions x ON x.claim_id = c.id
       ORDER BY c.rowid`,
    )
    .all()
    .map((row) => {
      if (!isRecord(row)) throw new Error("corrupt Bounty claim row");
      const claim = claimFromRow(row);
      if (row.state === "unfinished" && row.completion_id === null) {
        return {
          kind: "claimed-bounty" as const,
          claim,
          state: { kind: "unfinished" as const },
        };
      }
      if (row.state !== "completed")
        throw new Error("corrupt Bounty claim state");
      const completion = completionFromRow({
        id: row.completion_id,
        claim_id: row.id,
        member: row.member,
        completed_at: row.completed_at,
        credited_stars: row.credited_stars,
      });
      return {
        kind: "claimed-bounty" as const,
        claim,
        state: { kind: "completed" as const, completion },
      };
    });
}

export function isBountyDefinition(db: DatabaseSync, id: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM bounty_definitions WHERE id = ?").get(id),
  );
}

function normalizedPayload(command: BountyCommand): string {
  return JSON.stringify(command);
}

function priorReceipt(
  db: DatabaseSync,
  command: BountyCommand,
): BountyCommandReceipt | null {
  const row = db
    .prepare(
      "SELECT kind, payload, response FROM bounty_command_receipts WHERE request_id = ?",
    )
    .get(command.requestId);
  if (!row) return null;
  if (row.kind !== command.kind || row.payload !== normalizedPayload(command)) {
    throw new BountyStoreError(
      "That request identity has already been used for a different Bounty command.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(row.response));
  } catch {
    throw new Error("corrupt Bounty command receipt");
  }
  const parsed = parseBountyCommandReceipt(raw);
  if (!parsed) throw new Error("corrupt Bounty command receipt");
  if (parsed.status === "rejected") return parsed;
  return { ...parsed, status: "already-applied" };
}

function saveReceipt(
  db: DatabaseSync,
  command: BountyCommand,
  receipt: BountyCommandReceipt,
): void {
  db.prepare(
    "INSERT INTO bounty_command_receipts (request_id, kind, payload, response) VALUES (?, ?, ?, ?)",
  ).run(
    command.requestId,
    command.kind,
    normalizedPayload(command),
    JSON.stringify(receipt),
  );
}

export function claimBounty(input: {
  db: DatabaseSync;
  command: Extract<BountyCommand, { kind: "claim-bounty" }>;
  today: LocalDate;
}): BountyCommandReceipt {
  const { db, command, today } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = priorReceipt(db, command);
    if (replay) {
      db.exec("COMMIT");
      return replay;
    }
    const row = db
      .prepare(
        `SELECT o.id AS offering_id, d.id AS definition_id, d.title, d.stars
         FROM bounty_offerings o
         JOIN bounty_definitions d ON d.id = o.definition_id
         LEFT JOIN bounty_claims c ON c.offering_id = o.id
         WHERE d.id = ? AND d.retired_at IS NULL AND c.id IS NULL`,
      )
      .get(command.offering.definition);
    if (!row) throw new BountyStoreError("This Bounty is no longer available.");
    const claimId = newClaimId();
    db.prepare(
      `INSERT INTO bounty_claims
        (id, offering_id, definition_id, member, scheduled_on, title, stars, revision, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unfinished', ?)`,
    ).run(
      claimId,
      row.offering_id,
      row.definition_id,
      command.member,
      today,
      row.title,
      row.stars,
      nowInstant(),
    );
    const claim = claimFromRow(
      db
        .prepare("SELECT * FROM bounty_claims WHERE id = ?")
        .get(claimId) as Record<string, unknown>,
    );
    const receipt: BountyCommandReceipt = {
      status: "accepted",
      result: { kind: "claimed", claim },
    };
    saveReceipt(db, command, receipt);
    db.exec("COMMIT");
    return receipt;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeBounty(input: {
  db: DatabaseSync;
  command: Extract<BountyCommand, { kind: "complete-bounty" }>;
}): BountyCommandReceipt {
  const { db, command } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = priorReceipt(db, command);
    if (replay) {
      db.exec("COMMIT");
      return replay;
    }
    const row = db
      .prepare("SELECT * FROM bounty_claims WHERE id = ?")
      .get(command.claim);
    if (
      !row ||
      row.state !== "unfinished" ||
      row.revision !== command.revision
    ) {
      throw new BountyStoreError(
        "This Bounty claim has changed. Refresh and try again.",
      );
    }
    const member = String(row.member) as MemberId;
    const stars = Number(row.stars);
    const before = Number(
      db
        .prepare("SELECT balance FROM star_balances WHERE member = ?")
        .get(member)?.balance ?? 0,
    );
    const balance = before + stars;
    if (!Number.isSafeInteger(balance)) {
      throw new BountyStoreError("Star balance exceeds the supported limit.");
    }
    const completionId = newCompletionId();
    const at = nowInstant();
    db.prepare(
      `INSERT INTO bounty_completions
        (id, claim_id, request_id, member, completed_at, credited_stars)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(completionId, command.claim, command.requestId, member, at, stars);
    db.prepare(
      "UPDATE bounty_claims SET state = 'completed', revision = revision + 1 WHERE id = ?",
    ).run(command.claim);
    db.prepare(
      `INSERT INTO star_balances (member, balance) VALUES (?, ?)
       ON CONFLICT(member) DO UPDATE SET balance = excluded.balance`,
    ).run(member, balance);
    const completion = completionFromRow(
      db
        .prepare("SELECT * FROM bounty_completions WHERE id = ?")
        .get(completionId) as Record<string, unknown>,
    );
    const receipt: BountyCommandReceipt = {
      status: "accepted",
      result: { kind: "completed", completion },
    };
    saveReceipt(db, command, receipt);
    db.exec("COMMIT");
    return receipt;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
