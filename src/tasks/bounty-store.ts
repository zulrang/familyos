import type { DatabaseSync } from "node:sqlite";
import type { MemberId } from "@/members/members";
import type { BountyAdminCommand } from "./admin-types";
import {
  type AvailableBounty,
  type BountyClaim,
  type BountyCommand,
  type BountyCommandReceipt,
  type BountyCompletion,
  type BountyDefinition,
  type ClaimedBounty,
  type ClaimRevision,
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
  parseBountyDefinition,
  parseClaimId,
  parseClaimRevision,
  parseCompletionId,
  parseDefinitionRevision,
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
export class InactiveBountyMemberError extends Error {}
export class BountyAdminStoreError extends Error {}

export type BountyAdminReceipt = Readonly<{
  status: "accepted" | "already-applied";
  definition: BountyDefinition;
}>;

const BOUNTY_CLAIMS_V4 = `
    CREATE TABLE bounty_claims (
      id TEXT NOT NULL PRIMARY KEY,
      offering_id TEXT NOT NULL,
      definition_id TEXT NOT NULL,
      member TEXT NOT NULL,
      scheduled_on TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      state TEXT NOT NULL CHECK (state IN ('unfinished', 'completed', 'released')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (offering_id) REFERENCES bounty_offerings(id),
      FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
    );
    CREATE UNIQUE INDEX bounty_claims_one_current_per_offering
      ON bounty_claims(offering_id) WHERE state != 'released';
`;

const BOUNTY_CLAIM_TRIGGERS_V4 = `
    CREATE TRIGGER bounty_claims_update_guard BEFORE UPDATE ON bounty_claims
    BEGIN
      SELECT RAISE(ABORT, 'bounty claim snapshot is immutable') WHERE
        NEW.id IS NOT OLD.id OR NEW.offering_id IS NOT OLD.offering_id
        OR NEW.definition_id IS NOT OLD.definition_id OR NEW.member IS NOT OLD.member
        OR NEW.scheduled_on IS NOT OLD.scheduled_on OR NEW.title IS NOT OLD.title
        OR NEW.stars IS NOT OLD.stars OR NEW.created_at IS NOT OLD.created_at;
      SELECT RAISE(ABORT, 'invalid bounty claim transition') WHERE
        OLD.state != 'unfinished' OR NEW.state NOT IN ('completed', 'released')
        OR NEW.revision != OLD.revision + 1;
    END;
    CREATE TRIGGER bounty_claims_no_delete BEFORE DELETE ON bounty_claims
      BEGIN SELECT RAISE(ABORT, 'bounty claims cannot be deleted'); END;
`;

const BOUNTY_RECEIPTS_V4 = `
    CREATE TABLE bounty_command_receipts (
      request_id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('claim-bounty', 'complete-bounty', 'release-bounty')),
      payload TEXT NOT NULL,
      response TEXT NOT NULL
    );
`;

const BOUNTY_DEFINITION_TRIGGERS_V5 = `
    CREATE TRIGGER bounty_definitions_update_guard BEFORE UPDATE ON bounty_definitions
    BEGIN
      SELECT RAISE(ABORT, 'Bounty identity and recurrence are immutable') WHERE
        NEW.creation_order IS NOT OLD.creation_order OR NEW.id IS NOT OLD.id
        OR NEW.lineage IS NOT OLD.lineage OR NEW.type IS NOT OLD.type
        OR NEW.recurrence IS NOT OLD.recurrence;
      SELECT RAISE(ABORT, 'retired Bounty definition is frozen')
        WHERE OLD.retired_at IS NOT NULL;
      SELECT RAISE(ABORT, 'invalid Bounty definition revision')
        WHERE NEW.revision != OLD.revision + 1;
      SELECT RAISE(ABORT, 'retire must not change Bounty details') WHERE
        NEW.retired_at IS NOT NULL
        AND (NEW.title IS NOT OLD.title OR NEW.stars IS NOT OLD.stars);
    END;
    CREATE TRIGGER bounty_definitions_no_delete BEFORE DELETE ON bounty_definitions
      BEGIN SELECT RAISE(ABORT, 'bounty definitions cannot be deleted'); END;
`;

const BOUNTY_ADMIN_RECEIPTS_V5 = `
    CREATE TABLE bounty_admin_command_receipts (
      request_id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('edit-bounty', 'retire-bounty')),
      payload TEXT NOT NULL,
      response TEXT NOT NULL
    );
    CREATE TRIGGER bounty_admin_receipts_no_update
      BEFORE UPDATE ON bounty_admin_command_receipts
      BEGIN SELECT RAISE(ABORT, 'Bounty admin receipts are immutable'); END;
    CREATE TRIGGER bounty_admin_receipts_no_delete
      BEFORE DELETE ON bounty_admin_command_receipts
      BEGIN SELECT RAISE(ABORT, 'Bounty admin receipts are immutable'); END;
`;

function createBountyStore(db: DatabaseSync): void {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE bounty_definitions (
      creation_order INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      lineage TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      type TEXT NOT NULL CHECK (type = 'chore'),
      recurrence TEXT NOT NULL CHECK (recurrence = 'once'),
      stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      retired_at TEXT
    );
    CREATE TABLE bounty_offerings (
      id TEXT NOT NULL PRIMARY KEY,
      definition_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind = 'once'),
      FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
    );
    ${BOUNTY_CLAIMS_V4}
    CREATE TABLE bounty_completions (
      id TEXT NOT NULL PRIMARY KEY,
      claim_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      member TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      credited_stars INTEGER NOT NULL CHECK (credited_stars >= 0 AND credited_stars <= 9007199254740991),
      FOREIGN KEY (claim_id) REFERENCES bounty_claims(id)
    );
    ${BOUNTY_RECEIPTS_V4}
    ${BOUNTY_ADMIN_RECEIPTS_V5}
    ${BOUNTY_DEFINITION_TRIGGERS_V5}
    CREATE TRIGGER bounty_offerings_no_update BEFORE UPDATE ON bounty_offerings
      BEGIN SELECT RAISE(ABORT, 'bounty offerings are immutable'); END;
    CREATE TRIGGER bounty_offerings_no_delete BEFORE DELETE ON bounty_offerings
      BEGIN SELECT RAISE(ABORT, 'bounty offerings cannot be deleted'); END;
    ${BOUNTY_CLAIM_TRIGGERS_V4}
    CREATE TRIGGER bounty_completions_no_update BEFORE UPDATE ON bounty_completions
      BEGIN SELECT RAISE(ABORT, 'bounty completions are immutable'); END;
    CREATE TRIGGER bounty_completions_no_delete BEFORE DELETE ON bounty_completions
      BEGIN SELECT RAISE(ABORT, 'bounty completions are immutable'); END;
    CREATE TRIGGER bounty_receipts_no_update BEFORE UPDATE ON bounty_command_receipts
      BEGIN SELECT RAISE(ABORT, 'bounty receipts are immutable'); END;
    CREATE TRIGGER bounty_receipts_no_delete BEFORE DELETE ON bounty_command_receipts
      BEGIN SELECT RAISE(ABORT, 'bounty receipts are immutable'); END;
    PRAGMA user_version = 5;
    COMMIT;
  `);
}

function migrateBountyDefinitionsToV5(db: DatabaseSync): void {
  try {
    db.exec(`BEGIN IMMEDIATE;
      DROP TRIGGER IF EXISTS bounty_definitions_update_guard;
      DROP TRIGGER IF EXISTS bounty_definitions_no_delete;
      ALTER TABLE bounty_definitions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
        CHECK (revision >= 0);
      ${BOUNTY_ADMIN_RECEIPTS_V5}
      ${BOUNTY_DEFINITION_TRIGGERS_V5}
      PRAGMA user_version = 5;
      COMMIT;
    `);
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function migrateBountyClaimsToV4(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`BEGIN IMMEDIATE;
      DROP TRIGGER bounty_claims_update_guard;
      DROP TRIGGER bounty_claims_no_delete;
      CREATE TABLE bounty_claims_v4 (
        id TEXT NOT NULL PRIMARY KEY,
        offering_id TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        member TEXT NOT NULL,
        scheduled_on TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        state TEXT NOT NULL CHECK (state IN ('unfinished', 'completed', 'released')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (offering_id) REFERENCES bounty_offerings(id),
        FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
      );
      INSERT INTO bounty_claims_v4
        (id, offering_id, definition_id, member, scheduled_on, title, stars, revision, state, created_at)
        SELECT id, offering_id, definition_id, member, scheduled_on, title, stars, revision, state, created_at
        FROM bounty_claims;
      DROP TABLE bounty_claims;
      ALTER TABLE bounty_claims_v4 RENAME TO bounty_claims;
      CREATE UNIQUE INDEX bounty_claims_one_current_per_offering
        ON bounty_claims(offering_id) WHERE state != 'released';
      ${BOUNTY_CLAIM_TRIGGERS_V4}
      DROP TRIGGER bounty_receipts_no_update;
      DROP TRIGGER bounty_receipts_no_delete;
      CREATE TABLE bounty_command_receipts_v4 (
        request_id TEXT NOT NULL PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('claim-bounty', 'complete-bounty', 'release-bounty')),
        payload TEXT NOT NULL,
        response TEXT NOT NULL
      );
      INSERT INTO bounty_command_receipts_v4 SELECT * FROM bounty_command_receipts;
      DROP TABLE bounty_command_receipts;
      ALTER TABLE bounty_command_receipts_v4 RENAME TO bounty_command_receipts;
      CREATE TRIGGER bounty_receipts_no_update BEFORE UPDATE ON bounty_command_receipts
        BEGIN SELECT RAISE(ABORT, 'bounty receipts are immutable'); END;
      CREATE TRIGGER bounty_receipts_no_delete BEFORE DELETE ON bounty_command_receipts
        BEGIN SELECT RAISE(ABORT, 'bounty receipts are immutable'); END;
      PRAGMA user_version = 4;
    `);
    const foreignKeyError = db.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyError)
      throw new Error("Bounty migration broke a foreign key");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function migrateBountyStore(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  const claimsSql = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bounty_claims'",
    )
    .get()?.sql;
  if (typeof claimsSql !== "string") {
    createBountyStore(db);
    return;
  }
  if (!claimsSql.includes("'released'")) migrateBountyClaimsToV4(db);
  const hasDefinitionRevision = db
    .prepare("PRAGMA table_info(bounty_definitions)")
    .all()
    .some((column) => column.name === "revision");
  if (!hasDefinitionRevision) migrateBountyDefinitionsToV5(db);
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
  const revision = parseDefinitionRevision(row.revision);
  if (
    !id ||
    !lineage ||
    !title ||
    row.type !== "chore" ||
    row.recurrence !== "once" ||
    stars === null ||
    revision === null ||
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
    revision,
    retiredAt,
  };
}

function claimFromRow(row: Record<string, unknown>): {
  claim: BountyClaim;
  revision: ClaimRevision;
} {
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
    claim: {
      id,
      offering: { kind: "once", definition },
      member: row.member,
      scheduledOn,
      title,
      stars,
    },
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
        (id, lineage, title, type, recurrence, stars, revision, retired_at)
       VALUES (?, ?, ?, 'chore', 'once', ?, 0, NULL)`,
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

function priorAdminReceipt(
  db: DatabaseSync,
  command: BountyAdminCommand,
): BountyAdminReceipt | null {
  const row = db
    .prepare(
      "SELECT kind, payload, response FROM bounty_admin_command_receipts WHERE request_id = ?",
    )
    .get(command.requestId);
  if (!row) return null;
  const payload = JSON.stringify(command);
  if (row.kind !== command.kind || row.payload !== payload) {
    throw new BountyAdminStoreError(
      "That request identity was already used for a different Bounty change.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(row.response));
  } catch {
    throw new Error("corrupt Bounty administration receipt");
  }
  const definition = parseBountyDefinition(raw);
  if (!definition) throw new Error("corrupt Bounty administration receipt");
  return { status: "already-applied", definition };
}

export function administerBountyDefinition(input: {
  db: DatabaseSync;
  command: BountyAdminCommand;
  today: LocalDate;
}): BountyAdminReceipt {
  const { db, command, today } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = priorAdminReceipt(db, command);
    if (replay) {
      db.exec("COMMIT");
      return replay;
    }
    const current = db
      .prepare("SELECT * FROM bounty_definitions WHERE id = ?")
      .get(command.definition);
    if (
      !current ||
      current.retired_at !== null ||
      current.revision !== command.revision
    ) {
      throw new BountyAdminStoreError(
        "This Bounty changed or was retired. Refresh before saving.",
      );
    }
    if (command.kind === "edit-bounty") {
      db.prepare(
        `UPDATE bounty_definitions
         SET title = ?, stars = ?, revision = revision + 1
         WHERE id = ?`,
      ).run(command.draft.title, command.draft.stars, command.definition);
    } else {
      db.prepare(
        `UPDATE bounty_definitions
         SET retired_at = ?, revision = revision + 1
         WHERE id = ?`,
      ).run(today, command.definition);
    }
    const updated = bountyDefinitionFromRow(
      db
        .prepare("SELECT * FROM bounty_definitions WHERE id = ?")
        .get(command.definition) as Record<string, unknown>,
    );
    db.prepare(
      `INSERT INTO bounty_admin_command_receipts
        (request_id, kind, payload, response) VALUES (?, ?, ?, ?)`,
    ).run(
      command.requestId,
      command.kind,
      JSON.stringify(command),
      JSON.stringify(updated),
    );
    db.exec("COMMIT");
    return { status: "accepted", definition: updated };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
      `SELECT o.id, o.definition_id, d.title, d.stars, d.revision
       FROM bounty_offerings o
       JOIN bounty_definitions d ON d.id = o.definition_id
       WHERE d.retired_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM bounty_claims c
         WHERE c.offering_id = o.id AND c.state != 'released'
       )
       ORDER BY d.creation_order`,
    )
    .all()
    .map((row) => {
      const id = parseOfferingId(row.id);
      const definition = parseTaskId(row.definition_id);
      const title = parseTaskTitle(row.title);
      const stars = parseStarAmount(row.stars);
      const definitionRevision = parseDefinitionRevision(row.revision);
      if (
        !id ||
        !definition ||
        !title ||
        stars === null ||
        definitionRevision === null
      ) {
        throw new Error("corrupt Bounty offering row");
      }
      return {
        kind: "available" as const,
        id,
        offering: { kind: "once" as const, definition },
        title,
        stars,
        definitionRevision,
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
      const { claim, revision } = claimFromRow(row);
      if (row.state === "unfinished" && row.completion_id === null) {
        return {
          kind: "claimed-bounty" as const,
          claim,
          revision,
          state: { kind: "unfinished" as const },
        };
      }
      if (row.state === "released" && row.completion_id === null) {
        return {
          kind: "claimed-bounty" as const,
          claim,
          revision,
          state: { kind: "released" as const },
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
        revision,
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
  if (command.kind === "claim-bounty" && "compatibility" in command) {
    const { compatibility: _compatibility, ...v4Payload } = command;
    return JSON.stringify(v4Payload);
  }
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
  memberIsActive: boolean;
}): BountyCommandReceipt {
  const { db, command, today, memberIsActive } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = priorReceipt(db, command);
    if (replay) {
      db.exec("COMMIT");
      return replay;
    }
    if ("compatibility" in command) {
      throw new BountyStoreError(
        "This Bounty changed. Refresh before claiming it.",
      );
    }
    if (!memberIsActive) {
      throw new InactiveBountyMemberError("active member required");
    }
    const row = db
      .prepare(
        `SELECT o.id AS offering_id, d.id AS definition_id, d.title, d.stars
         FROM bounty_offerings o
         JOIN bounty_definitions d ON d.id = o.definition_id
         WHERE d.id = ? AND d.revision = ? AND d.retired_at IS NULL AND NOT EXISTS (
           SELECT 1 FROM bounty_claims c
           WHERE c.offering_id = o.id AND c.state != 'released'
         )`,
      )
      .get(command.offering.definition, command.definitionRevision);
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
    const claimed = claimFromRow(
      db
        .prepare("SELECT * FROM bounty_claims WHERE id = ?")
        .get(claimId) as Record<string, unknown>,
    );
    const receipt: BountyCommandReceipt = {
      status: "accepted",
      result: { kind: "claimed", ...claimed },
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

function releaseClaimRow(
  db: DatabaseSync,
  row: Record<string, unknown>,
): {
  claim: BountyClaim;
  revision: ClaimRevision;
} {
  const current = claimFromRow(row);
  db.prepare(
    "UPDATE bounty_claims SET state = 'released', revision = revision + 1 WHERE id = ?",
  ).run(current.claim.id);
  const released = claimFromRow(
    db
      .prepare("SELECT * FROM bounty_claims WHERE id = ?")
      .get(current.claim.id) as Record<string, unknown>,
  );
  return released;
}

export function releaseBounty(input: {
  db: DatabaseSync;
  command: Extract<BountyCommand, { kind: "release-bounty" }>;
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
    const released = releaseClaimRow(db, row as Record<string, unknown>);
    const receipt: BountyCommandReceipt = {
      status: "accepted",
      result: {
        kind: "released",
        claim: released.claim,
        revision: released.revision,
      },
    };
    saveReceipt(db, command, receipt);
    db.exec("COMMIT");
    return receipt;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Runs inside the caller's task transaction and is safe to repeat. */
export function releaseBountiesForRetiredMembers(
  db: DatabaseSync,
  retiredMembers: ReadonlySet<MemberId>,
): void {
  if (retiredMembers.size === 0) return;
  const claims = db
    .prepare("SELECT * FROM bounty_claims WHERE state = 'unfinished'")
    .all()
    .filter((row) => retiredMembers.has(String(row.member)));
  for (const row of claims) releaseClaimRow(db, row as Record<string, unknown>);
}
