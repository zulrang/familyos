import type { DatabaseSync } from "node:sqlite";
import type { HouseholdMember, MemberId } from "@/members/members";
import type {
  BountyAdminCommand,
  DefinitionReplacementCommand,
} from "./admin-types";
import {
  type BountyRecurrence,
  parseBountyRecurrence,
  sameBountyRecurrence,
} from "./bounty-calendar";
import { currentOfferingKey, sameOfferingKey } from "./bounty-offerings";
import {
  migrateBountyLifecycleToV8,
  migrateBountyLifecycleToV9,
} from "./bounty-schema";
import {
  type AcceptedOfferingKey,
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
  type LineageId,
  type LocalDate,
  newClaimId,
  newCompletionId,
  newOfferingId,
  newTaskId,
  nowInstant,
  type OfferingKey,
  parseBountyCommandReceipt,
  parseBountyCorrectionId,
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
  type TaskId,
} from "./types";

export class BountyStoreError extends Error {}
export class InactiveBountyMemberError extends Error {}
export class BountyAdminStoreError extends Error {}

export type BountyAdminReceipt = Readonly<{
  status: "accepted" | "already-applied";
  definition: BountyDefinition;
}>;

export type DefinitionReplacementReceipt = Readonly<{
  status: "accepted" | "already-applied";
  replacement: Readonly<{
    kind: "assigned" | "bounty";
    id: TaskId;
    lineage: LineageId;
  }>;
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

const BOUNTY_ADMIN_RECEIPT_TRIGGERS = `
    CREATE TRIGGER bounty_admin_receipts_no_update
      BEFORE UPDATE ON bounty_admin_command_receipts
      BEGIN SELECT RAISE(ABORT, 'Bounty admin receipts are immutable'); END;
    CREATE TRIGGER bounty_admin_receipts_no_delete
      BEFORE DELETE ON bounty_admin_command_receipts
      BEGIN SELECT RAISE(ABORT, 'Bounty admin receipts are immutable'); END;
`;

const BOUNTY_ADMIN_RECEIPTS_V5 = `
    CREATE TABLE bounty_admin_command_receipts (
      request_id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('edit-bounty', 'retire-bounty')),
      payload TEXT NOT NULL,
      response TEXT NOT NULL
    );
    ${BOUNTY_ADMIN_RECEIPT_TRIGGERS}
`;

const BOUNTY_ADMIN_RECEIPTS_V7 = `
    CREATE TABLE bounty_admin_command_receipts (
      request_id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('edit-bounty', 'retire-bounty', 'replace-definition')),
      payload TEXT NOT NULL,
      response TEXT NOT NULL
    );
    ${BOUNTY_ADMIN_RECEIPT_TRIGGERS}
`;

const BOUNTY_DEFINITION_TRIGGERS_V7 = `
    CREATE TRIGGER bounty_definitions_update_guard BEFORE UPDATE ON bounty_definitions
    BEGIN
      SELECT RAISE(ABORT, 'Bounty identity and recurrence are immutable') WHERE
        NEW.creation_order IS NOT OLD.creation_order OR NEW.id IS NOT OLD.id
        OR NEW.lineage IS NOT OLD.lineage OR NEW.type IS NOT OLD.type
        OR NEW.recurrence IS NOT OLD.recurrence OR NEW.offer_from IS NOT OLD.offer_from;
      SELECT RAISE(ABORT, 'retired Bounty definition is frozen') WHERE OLD.retired_at IS NOT NULL;
      SELECT RAISE(ABORT, 'invalid Bounty definition revision') WHERE NEW.revision != OLD.revision + 1;
      SELECT RAISE(ABORT, 'retire must not change Bounty details') WHERE NEW.retired_at IS NOT NULL
        AND (NEW.title IS NOT OLD.title OR NEW.stars IS NOT OLD.stars);
    END;
    CREATE TRIGGER bounty_definitions_no_delete BEFORE DELETE ON bounty_definitions
      BEGIN SELECT RAISE(ABORT, 'bounty definitions cannot be deleted'); END;
`;

const BOUNTY_DEFINITIONS_V7 = `
    CREATE TABLE bounty_definitions (
      creation_order INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      lineage TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      type TEXT NOT NULL CHECK (type = 'chore'),
      recurrence TEXT NOT NULL CHECK (recurrence = 'once' OR json_valid(recurrence)),
      stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      offer_from TEXT,
      retired_at TEXT
    );
`;

const BOUNTY_OFFERINGS_V6 = `
    CREATE TABLE bounty_offerings (
      id TEXT NOT NULL PRIMARY KEY,
      definition_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('once', 'recurring')),
      interval_start TEXT,
      CHECK (
        (kind = 'once' AND interval_start IS NULL)
        OR (kind = 'recurring' AND interval_start IS NOT NULL)
      ),
      FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
    );
    CREATE UNIQUE INDEX bounty_offerings_once_definition
      ON bounty_offerings(definition_id) WHERE kind = 'once';
    CREATE UNIQUE INDEX bounty_offerings_recurring_interval
      ON bounty_offerings(definition_id, interval_start) WHERE kind = 'recurring';
`;

function createBountyStore(db: DatabaseSync): void {
  db.exec(`BEGIN IMMEDIATE;
    ${BOUNTY_DEFINITIONS_V7}
    ${BOUNTY_OFFERINGS_V6}
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
    ${BOUNTY_ADMIN_RECEIPTS_V7}
    ${BOUNTY_DEFINITION_TRIGGERS_V7}
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
    PRAGMA user_version = 7;
    COMMIT;
  `);
}

function migrateBountyDefinitionsToV7(db: DatabaseSync): void {
  try {
    db.exec(`BEGIN IMMEDIATE;
      DROP TRIGGER bounty_definitions_update_guard;
      DROP TRIGGER bounty_definitions_no_delete;
      DROP TRIGGER bounty_admin_receipts_no_update;
      DROP TRIGGER bounty_admin_receipts_no_delete;
      ALTER TABLE bounty_definitions ADD COLUMN offer_from TEXT;
      CREATE TABLE bounty_admin_command_receipts_v7 (
        request_id TEXT NOT NULL PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('edit-bounty', 'retire-bounty', 'replace-definition')),
        payload TEXT NOT NULL,
        response TEXT NOT NULL
      );
      INSERT INTO bounty_admin_command_receipts_v7 SELECT * FROM bounty_admin_command_receipts;
      DROP TABLE bounty_admin_command_receipts;
      ALTER TABLE bounty_admin_command_receipts_v7 RENAME TO bounty_admin_command_receipts;
      ${BOUNTY_ADMIN_RECEIPT_TRIGGERS}
      ${BOUNTY_DEFINITION_TRIGGERS_V7}
      PRAGMA user_version = 7;
      COMMIT;
    `);
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function migrateBountyDefinitionsAndOfferingsToV6(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`BEGIN IMMEDIATE;
      DROP TRIGGER IF EXISTS bounty_definitions_update_guard;
      DROP TRIGGER IF EXISTS bounty_definitions_no_delete;
      DROP TRIGGER IF EXISTS bounty_offerings_no_update;
      DROP TRIGGER IF EXISTS bounty_offerings_no_delete;
      CREATE TABLE bounty_definitions_v6 (
        creation_order INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        lineage TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        type TEXT NOT NULL CHECK (type = 'chore'),
        recurrence TEXT NOT NULL CHECK (recurrence = 'once' OR json_valid(recurrence)),
        stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        retired_at TEXT
      );
      INSERT INTO bounty_definitions_v6
        (creation_order, id, lineage, title, type, recurrence, stars, revision, retired_at)
        SELECT creation_order, id, lineage, title, type, recurrence, stars, revision, retired_at
        FROM bounty_definitions;
      CREATE TABLE bounty_offerings_v6 (
        id TEXT NOT NULL PRIMARY KEY,
        definition_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('once', 'recurring')),
        interval_start TEXT,
        CHECK (
          (kind = 'once' AND interval_start IS NULL)
          OR (kind = 'recurring' AND interval_start IS NOT NULL)
        ),
        FOREIGN KEY (definition_id) REFERENCES bounty_definitions_v6(id)
      );
      INSERT INTO bounty_offerings_v6 (id, definition_id, kind, interval_start)
        SELECT id, definition_id, kind, NULL FROM bounty_offerings;
      DROP TABLE bounty_offerings;
      DROP TABLE bounty_definitions;
      ALTER TABLE bounty_definitions_v6 RENAME TO bounty_definitions;
      ALTER TABLE bounty_offerings_v6 RENAME TO bounty_offerings;
      CREATE UNIQUE INDEX bounty_offerings_once_definition
        ON bounty_offerings(definition_id) WHERE kind = 'once';
      CREATE UNIQUE INDEX bounty_offerings_recurring_interval
        ON bounty_offerings(definition_id, interval_start) WHERE kind = 'recurring';
      ${BOUNTY_DEFINITION_TRIGGERS_V5}
      CREATE TRIGGER bounty_offerings_no_update BEFORE UPDATE ON bounty_offerings
        BEGIN SELECT RAISE(ABORT, 'bounty offerings are immutable'); END;
      CREATE TRIGGER bounty_offerings_no_delete BEFORE DELETE ON bounty_offerings
        BEGIN SELECT RAISE(ABORT, 'bounty offerings cannot be deleted'); END;
      PRAGMA user_version = 6;
    `);
    const foreignKeyError = db.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyError)
      throw new Error("Bounty recurrence migration broke a foreign key");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
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
  } else {
    if (!claimsSql.includes("'released'")) migrateBountyClaimsToV4(db);
    const hasDefinitionRevision = db
      .prepare("PRAGMA table_info(bounty_definitions)")
      .all()
      .some((column) => column.name === "revision");
    if (!hasDefinitionRevision) migrateBountyDefinitionsToV5(db);
    const hasIntervalStart = db
      .prepare("PRAGMA table_info(bounty_offerings)")
      .all()
      .some((column) => column.name === "interval_start");
    if (!hasIntervalStart) migrateBountyDefinitionsAndOfferingsToV6(db);
  }
  const hasOfferFrom = db
    .prepare("PRAGMA table_info(bounty_definitions)")
    .all()
    .some((column) => column.name === "offer_from");
  if (!hasOfferFrom) migrateBountyDefinitionsToV7(db);
  migrateBountyLifecycleToV8(db);
  migrateBountyLifecycleToV9(db);
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
  const offerFrom =
    row.offer_from === null ? null : parseLocalDate(row.offer_from);
  let recurrence: BountyRecurrence | null = null;
  if (row.recurrence === "once") recurrence = { kind: "once" };
  else if (typeof row.recurrence === "string") {
    try {
      recurrence = parseBountyRecurrence(JSON.parse(row.recurrence));
    } catch {
      recurrence = null;
    }
  }
  if (
    !id ||
    !lineage ||
    !title ||
    row.type !== "chore" ||
    !recurrence ||
    stars === null ||
    revision === null ||
    (row.offer_from !== null && !offerFrom) ||
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
    recurrence,
    offerFrom,
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
  const intervalStart =
    row.offering_kind === "recurring" || row.offering_kind === "legacy"
      ? parseLocalDate(row.interval_start)
      : null;
  const sourceWindow =
    row.offering_kind === "legacy" ? parseLocalDate(row.source_window) : null;
  const offering: AcceptedOfferingKey | null =
    definition && row.offering_kind === "once" && row.interval_start === null
      ? { kind: "once", definition }
      : definition && row.offering_kind === "recurring" && intervalStart
        ? { kind: "recurring", definition, intervalStart }
        : definition && row.offering_kind === "legacy" && sourceWindow
          ? { kind: "legacy", definition, sourceWindow, intervalStart }
          : null;
  if (
    !id ||
    !definition ||
    !scheduledOn ||
    typeof row.member !== "string" ||
    !row.member ||
    !title ||
    stars === null ||
    revision === null ||
    !offering ||
    (row.offering_kind === "legacy" &&
      row.interval_start !== null &&
      intervalStart === null)
  ) {
    throw new Error("corrupt Bounty claim row");
  }
  return {
    claim: {
      id,
      offering,
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
  const claim = parseClaimId(row.claim_id ?? row.subject_id);
  const at = parseInstant(row.completed_at);
  const creditedStars = parseStarAmount(row.credited_stars);
  const creditProvenance =
    row.credit_provenance === "recorded" ||
    row.credit_provenance === "legacy-missing"
      ? row.credit_provenance
      : null;
  if (
    !id ||
    !claim ||
    !at ||
    typeof row.member !== "string" ||
    !row.member ||
    creditedStars === null ||
    !creditProvenance
  ) {
    throw new Error("corrupt Bounty completion row");
  }
  return { id, claim, by: row.member, at, creditedStars, creditProvenance };
}

function materializeCurrentOffering(
  db: DatabaseSync,
  definition: BountyDefinition,
  today: LocalDate,
): OfferingKey | null {
  const offering = currentOfferingKey(definition, today);
  if (!offering) return null;
  db.prepare(
    `INSERT OR IGNORE INTO bounty_offerings
      (id, definition_id, kind, interval_start) VALUES (?, ?, ?, ?)`,
  ).run(
    newOfferingId(),
    offering.definition,
    offering.kind,
    offering.kind === "recurring" ? offering.intervalStart : null,
  );
  return offering;
}

export function reconcileBountyOfferings(
  db: DatabaseSync,
  today: LocalDate,
): void {
  for (const definition of loadBountyDefinitions(db)) {
    materializeCurrentOffering(db, definition, today);
  }
}

export function createBounty(
  db: DatabaseSync,
  draft: CreateBountyDraft,
  today: LocalDate,
): BountyDefinition {
  const definition = createBountyDefinition(draft);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO bounty_definitions
        (id, lineage, title, type, recurrence, stars, revision, retired_at)
       VALUES (?, ?, ?, 'chore', ?, ?, 0, NULL)`,
    ).run(
      definition.id,
      definition.lineage,
      definition.title,
      definition.recurrence.kind === "once"
        ? "once"
        : JSON.stringify(definition.recurrence),
      definition.stars,
    );
    materializeCurrentOffering(db, definition, today);
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

export function replaceDefinition(input: {
  db: DatabaseSync;
  command: DefinitionReplacementCommand;
  today: LocalDate;
  members: readonly HouseholdMember[];
}): DefinitionReplacementReceipt {
  const { db, command, today, members } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const prior = db
      .prepare(
        "SELECT kind, payload, response FROM bounty_admin_command_receipts WHERE request_id = ?",
      )
      .get(command.requestId);
    if (prior) {
      if (
        prior.kind !== command.kind ||
        prior.payload !== JSON.stringify(command)
      ) {
        throw new BountyAdminStoreError(
          "That request identity was already used for a different Bounty change.",
        );
      }
      let raw: unknown;
      try {
        raw = JSON.parse(String(prior.response));
      } catch {
        throw new Error("corrupt definition replacement receipt");
      }
      if (!isRecord(raw) || !isRecord(raw.replacement))
        throw new Error("corrupt definition replacement receipt");
      const id = parseTaskId(raw.replacement.id);
      const lineage = parseLineageId(raw.replacement.lineage);
      const kind = raw.replacement.kind;
      if (!id || !lineage || (kind !== "assigned" && kind !== "bounty"))
        throw new Error("corrupt definition replacement receipt");
      db.exec("COMMIT");
      return { status: "already-applied", replacement: { kind, id, lineage } };
    }

    if (command.replacement.kind === "assigned") {
      const assignment = command.replacement.assignment;
      const assigned =
        assignment.kind === "fixed" ? [assignment.member] : assignment.order;
      if (
        assigned.some(
          (id) =>
            members.find((member) => member.id === id)?.status !== "active",
        )
      ) {
        throw new InactiveBountyMemberError(
          "Assign tasks only to active members.",
        );
      }
    }

    const source =
      command.source.kind === "bounty"
        ? db
            .prepare(
              "SELECT lineage, revision, retired_at FROM bounty_definitions WHERE id = ?",
            )
            .get(command.source.definition)
        : db
            .prepare(
              "SELECT lineage, type, retired_at FROM definitions WHERE id = ?",
            )
            .get(command.source.definition);
    if (
      !source ||
      source.retired_at !== null ||
      (command.source.kind === "bounty" &&
        source.revision !== command.source.revision) ||
      (command.source.kind === "assigned" && source.type !== "chore")
    ) {
      throw new BountyAdminStoreError(
        "This definition changed or was retired. Refresh before saving.",
      );
    }
    const lineage = parseLineageId(source.lineage);
    if (!lineage) throw new Error("corrupt source definition");
    if (
      command.source.kind === "bounty" &&
      command.replacement.kind === "bounty"
    ) {
      const current = bountyDefinitionFromRow(
        db
          .prepare("SELECT * FROM bounty_definitions WHERE id = ?")
          .get(command.source.definition) as Record<string, unknown>,
      );
      if (
        sameBountyRecurrence(current.recurrence, command.replacement.recurrence)
      ) {
        db.prepare(
          `UPDATE bounty_definitions
           SET title = ?, stars = ?, revision = revision + 1
           WHERE id = ?`,
        ).run(command.replacement.title, command.replacement.stars, current.id);
        const replacement = {
          kind: "bounty" as const,
          id: current.id,
          lineage,
        };
        db.prepare(
          `INSERT INTO bounty_admin_command_receipts
            (request_id, kind, payload, response)
           VALUES (?, 'replace-definition', ?, ?)`,
        ).run(
          command.requestId,
          JSON.stringify(command),
          JSON.stringify({ replacement }),
        );
        db.exec("COMMIT");
        return { status: "accepted", replacement };
      }
    }

    const id = newTaskId();
    if (command.source.kind === "bounty") {
      db.prepare(
        "UPDATE bounty_definitions SET retired_at = ?, revision = revision + 1 WHERE id = ?",
      ).run(today, command.source.definition);
    } else {
      db.prepare(
        "UPDATE definitions SET retired_at = ? WHERE id = ? AND retired_at IS NULL",
      ).run(today, command.source.definition);
    }

    if (command.replacement.kind === "bounty") {
      const recurrence =
        command.replacement.recurrence.kind === "once"
          ? "once"
          : JSON.stringify(command.replacement.recurrence);
      db.prepare(
        `INSERT INTO bounty_definitions
          (id, lineage, title, type, recurrence, stars, revision, offer_from, retired_at)
         VALUES (?, ?, ?, 'chore', ?, ?, 0, ?, NULL)`,
      ).run(
        id,
        lineage,
        command.replacement.title,
        recurrence,
        command.replacement.stars,
        command.replacement.recurrence.kind === "recurring" ? today : null,
      );
      const definition = bountyDefinitionFromRow(
        db
          .prepare("SELECT * FROM bounty_definitions WHERE id = ?")
          .get(id) as Record<string, unknown>,
      );
      materializeCurrentOffering(db, definition, today);
    } else {
      const { kind: _kind, ...draft } = command.replacement;
      db.prepare(
        `INSERT INTO definitions
          (id, lineage, title, type, recurrence, assignment, time, stars, retired_at)
         VALUES (?, ?, ?, 'chore', ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        lineage,
        draft.title,
        JSON.stringify(draft.recurrence),
        JSON.stringify(draft.assignment),
        draft.time,
        draft.stars,
      );
    }
    const replacement = {
      kind: command.replacement.kind,
      id,
      lineage,
    } as const;
    db.prepare(`INSERT INTO bounty_admin_command_receipts
      (request_id, kind, payload, response) VALUES (?, 'replace-definition', ?, ?)`).run(
      command.requestId,
      JSON.stringify(command),
      JSON.stringify({ replacement }),
    );
    db.exec("COMMIT");
    return { status: "accepted", replacement };
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

export function loadAvailableBounties(
  db: DatabaseSync,
  today: LocalDate,
): AvailableBounty[] {
  reconcileBountyOfferings(db, today);
  return db
    .prepare(
      `SELECT o.id AS offering_id, o.definition_id,
              o.kind AS offering_kind, o.interval_start,
              d.id, d.lineage, d.title, d.type, d.recurrence, d.stars,
              d.revision, d.offer_from, d.retired_at
       FROM bounty_offerings o
       JOIN bounty_definitions d ON d.id = o.definition_id
       WHERE o.kind != 'legacy' AND d.retired_at IS NULL
       ORDER BY d.creation_order`,
    )
    .all()
    .flatMap((row) => {
      if (!isRecord(row)) throw new Error("corrupt Bounty offering row");
      const id = parseOfferingId(row.offering_id);
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
      const bounty = bountyDefinitionFromRow(row);
      const intervalStart =
        row.offering_kind === "recurring"
          ? parseLocalDate(row.interval_start)
          : null;
      const offering: OfferingKey | null =
        row.offering_kind === "once"
          ? { kind: "once", definition }
          : intervalStart
            ? { kind: "recurring", definition, intervalStart }
            : null;
      const current = currentOfferingKey(bounty, today);
      if (
        !offering ||
        !current ||
        !sameOfferingKey(offering, current) ||
        offeringIsReserved(db, id)
      )
        return [];
      return [
        {
          kind: "available" as const,
          id,
          offering,
          title,
          stars,
          definitionRevision,
        },
      ];
    });
}

function offeringIsReserved(db: DatabaseSync, offering: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM bounty_offerings candidate
         WHERE candidate.id = ? AND (
           EXISTS (
             SELECT 1 FROM bounty_claims c
             JOIN bounty_offerings reserved ON reserved.id = c.offering_id
             WHERE c.state != 'released'
               AND reserved.definition_id = candidate.definition_id
               AND (
                 (candidate.kind = 'once' AND reserved.kind IN ('once', 'legacy')
                   AND reserved.interval_start IS NULL)
                 OR (candidate.kind = 'recurring'
                   AND reserved.kind IN ('recurring', 'legacy')
                   AND reserved.interval_start = candidate.interval_start)
               )
           ) OR EXISTS (
             SELECT 1 FROM legacy_bounty_completion_carriers carrier
             JOIN bounty_offerings reserved ON reserved.id = carrier.offering_id
             WHERE carrier.state = 'completed'
               AND reserved.definition_id = candidate.definition_id
               AND (
                 (candidate.kind = 'once' AND reserved.interval_start IS NULL)
                 OR (candidate.kind = 'recurring'
                   AND reserved.interval_start = candidate.interval_start)
               )
           )
         )`,
      )
      .get(offering),
  );
}

export function loadBountyClaims(db: DatabaseSync): ClaimedBounty[] {
  return db
    .prepare(
      `SELECT c.*, o.kind AS offering_kind, o.interval_start, o.source_window,
              x.id AS completion_id, x.member AS completion_member,
              x.completed_at, x.credited_stars, x.credit_provenance,
              u.id AS undone_completion_id,
              u.member AS undone_completion_member,
              u.completed_at AS undone_completed_at,
              u.credited_stars AS undone_credited_stars,
              u.credit_provenance AS undone_credit_provenance
       FROM bounty_claims c
       JOIN bounty_offerings o ON o.id = c.offering_id
       LEFT JOIN bounty_completions x ON x.id = c.effective_completion_id
       LEFT JOIN bounty_completions u ON u.id = c.restorable_completion_id
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
      if (row.state === "reopened" && row.undone_completion_id !== null) {
        const correction = parseBountyCorrectionId(row.correction_id);
        if (!correction) throw new Error("corrupt reopened Bounty claim");
        return {
          kind: "claimed-bounty" as const,
          claim,
          revision,
          state: {
            kind: "reopened" as const,
            undoneCompletion: completionFromRow({
              id: row.undone_completion_id,
              subject_id: row.id,
              member: row.undone_completion_member,
              completed_at: row.undone_completed_at,
              credited_stars: row.undone_credited_stars,
              credit_provenance: row.undone_credit_provenance,
            }),
            correction,
          },
        };
      }
      if (row.state !== "completed" || row.completion_id === null)
        throw new Error("corrupt Bounty claim state");
      const completion = completionFromRow({
        id: row.completion_id,
        subject_id: row.id,
        member: row.completion_member,
        completed_at: row.completed_at,
        credited_stars: row.credited_stars,
        credit_provenance: row.credit_provenance,
      });
      const correction =
        row.correction_id === null
          ? null
          : parseBountyCorrectionId(row.correction_id);
      if (row.correction_id !== null && !correction)
        throw new Error("corrupt Bounty correction identity");
      const creditedTo =
        row.correction_id === null
          ? completion.by
          : db
              .prepare(
                "SELECT to_member FROM bounty_completion_corrections WHERE id = ?",
              )
              .get(row.correction_id)?.to_member;
      if (typeof creditedTo !== "string" || !creditedTo)
        throw new Error("corrupt effective Bounty credit");
      return {
        kind: "claimed-bounty" as const,
        claim,
        revision,
        state: {
          kind: "completed" as const,
          completion,
          creditedTo,
          correction,
        },
      };
    });
}

export function loadBountyCompletions(db: DatabaseSync): BountyCompletion[] {
  return db
    .prepare(
      `SELECT x.* FROM bounty_completions x
       JOIN bounty_work_subjects s ON s.id = x.subject_id
       WHERE s.kind = 'accepted-claim' ORDER BY x.completed_at, x.rowid`,
    )
    .all()
    .map((row) => {
      if (!isRecord(row)) throw new Error("corrupt Bounty completion row");
      return completionFromRow(row);
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
  members: readonly HouseholdMember[];
}): BountyCommandReceipt {
  const { db, command, today, members } = input;
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
    if (
      members.find((member) => member.id === command.member)?.status !==
      "active"
    ) {
      throw new InactiveBountyMemberError("active member required");
    }
    const definitionRow = db
      .prepare(
        "SELECT * FROM bounty_definitions WHERE id = ? AND revision = ? AND retired_at IS NULL",
      )
      .get(command.offering.definition, command.definitionRevision);
    if (!isRecord(definitionRow))
      throw new BountyStoreError("This Bounty is no longer available.");
    const definition = bountyDefinitionFromRow(definitionRow);
    const current = currentOfferingKey(definition, today);
    if (!current || !sameOfferingKey(current, command.offering)) {
      throw new BountyStoreError("This Bounty offering has expired.");
    }
    const row = db
      .prepare(
        `SELECT o.id AS offering_id, d.id AS definition_id, d.title, d.stars,
                o.kind AS offering_kind, o.interval_start
         FROM bounty_offerings o
         JOIN bounty_definitions d ON d.id = o.definition_id
         WHERE d.id = ? AND d.revision = ? AND o.kind = ?
           AND o.interval_start IS ? AND d.retired_at IS NULL`,
      )
      .get(
        command.offering.definition,
        command.definitionRevision,
        command.offering.kind,
        command.offering.kind === "recurring"
          ? command.offering.intervalStart
          : null,
      );
    if (!row || offeringIsReserved(db, String(row.offering_id)))
      throw new BountyStoreError("This Bounty is no longer available.");
    const claimId = newClaimId();
    db.prepare(
      "INSERT INTO bounty_work_subjects (id, kind) VALUES (?, 'accepted-claim')",
    ).run(claimId);
    db.prepare(
      `INSERT INTO bounty_claims
        (id, offering_id, definition_id, member, scheduled_on, title, stars,
         revision, state, acceptance_provenance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unfinished', 'native', ?)`,
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
        .prepare(
          `SELECT c.*, o.kind AS offering_kind, o.interval_start, o.source_window
           FROM bounty_claims c JOIN bounty_offerings o ON o.id = c.offering_id
           WHERE c.id = ?`,
        )
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
      (row.state !== "unfinished" && row.state !== "reopened") ||
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
        (id, subject_id, request_id, origin, member, completed_at,
         credited_stars, credit_provenance)
       VALUES (?, ?, ?, 'native', ?, ?, ?, 'recorded')`,
    ).run(completionId, command.claim, command.requestId, member, at, stars);
    db.prepare(
      `UPDATE bounty_claims
       SET state = 'completed', revision = revision + 1,
           effective_completion_id = ?, restorable_completion_id = NULL,
           correction_id = NULL
       WHERE id = ?`,
    ).run(completionId, command.claim);
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
    `UPDATE bounty_claims
     SET state = 'released', revision = revision + 1,
         effective_completion_id = NULL, restorable_completion_id = NULL,
         correction_id = NULL
     WHERE id = ?`,
  ).run(current.claim.id);
  const released = claimFromRow(
    db
      .prepare(
        `SELECT c.*, o.kind AS offering_kind, o.interval_start, o.source_window
         FROM bounty_claims c JOIN bounty_offerings o ON o.id = c.offering_id
         WHERE c.id = ?`,
      )
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
      .prepare(
        `SELECT c.*, o.kind AS offering_kind, o.interval_start, o.source_window
         FROM bounty_claims c JOIN bounty_offerings o ON o.id = c.offering_id
         WHERE c.id = ?`,
      )
      .get(command.claim);
    if (
      !row ||
      (row.state !== "unfinished" && row.state !== "reopened") ||
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
    .prepare(
      `SELECT c.*, o.kind AS offering_kind, o.interval_start, o.source_window
       FROM bounty_claims c JOIN bounty_offerings o ON o.id = c.offering_id
       WHERE c.state IN ('unfinished', 'reopened')`,
    )
    .all()
    .filter((row) => retiredMembers.has(String(row.member)));
  for (const row of claims) releaseClaimRow(db, row as Record<string, unknown>);
}
