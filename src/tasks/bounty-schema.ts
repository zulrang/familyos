import type { DatabaseSync } from "node:sqlite";

const CLAIMS_V8 = `
  CREATE TABLE bounty_claims_v8 (
    id TEXT NOT NULL PRIMARY KEY,
    offering_id TEXT NOT NULL,
    definition_id TEXT NOT NULL,
    member TEXT NOT NULL,
    scheduled_on TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    stars INTEGER NOT NULL CHECK (stars >= 0 AND stars <= 9007199254740991),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    state TEXT NOT NULL CHECK (state IN ('unfinished', 'reopened', 'completed', 'released')),
    effective_completion_id TEXT,
    restorable_completion_id TEXT,
    correction_id TEXT,
    created_at TEXT NOT NULL,
    CHECK (
      (state IN ('unfinished', 'released')
        AND effective_completion_id IS NULL
        AND restorable_completion_id IS NULL
        AND correction_id IS NULL)
      OR (state = 'completed'
        AND effective_completion_id IS NOT NULL
        AND restorable_completion_id IS NULL)
      OR (state = 'reopened'
        AND effective_completion_id IS NULL
        AND restorable_completion_id IS NOT NULL
        AND correction_id IS NOT NULL)
    ),
    FOREIGN KEY (offering_id) REFERENCES bounty_offerings(id),
    FOREIGN KEY (definition_id) REFERENCES bounty_definitions(id)
  );
`;

const COMPLETIONS_V8 = `
  CREATE TABLE bounty_completions_v8 (
    id TEXT NOT NULL PRIMARY KEY,
    claim_id TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    member TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    credited_stars INTEGER NOT NULL CHECK (credited_stars >= 0 AND credited_stars <= 9007199254740991),
    credit_provenance TEXT NOT NULL CHECK (credit_provenance IN ('recorded', 'legacy-missing')),
    FOREIGN KEY (claim_id) REFERENCES bounty_claims_v8(id)
  );
`;

const HISTORY_V8 = `
  CREATE TABLE bounty_completion_corrections (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('undo', 'restore', 'reassign')),
    claim_id TEXT NOT NULL,
    completion_id TEXT NOT NULL,
    predecessor_id TEXT,
    from_member TEXT,
    to_member TEXT,
    credited_stars INTEGER NOT NULL CHECK (credited_stars >= 0 AND credited_stars <= 9007199254740991),
    credit_provenance TEXT NOT NULL CHECK (credit_provenance IN ('recorded', 'legacy-missing')),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    corrected_at TEXT NOT NULL,
    CHECK (
      (kind = 'undo' AND from_member IS NOT NULL AND to_member IS NULL)
      OR (kind = 'restore' AND from_member IS NULL AND to_member IS NOT NULL)
      OR (kind = 'reassign' AND from_member IS NOT NULL AND to_member IS NOT NULL
        AND from_member != to_member)
    ),
    FOREIGN KEY (claim_id) REFERENCES bounty_claims(id),
    FOREIGN KEY (completion_id) REFERENCES bounty_completions(id),
    FOREIGN KEY (predecessor_id) REFERENCES bounty_completion_corrections(id)
  );
  CREATE TABLE bounty_correction_receipts (
    request_id TEXT NOT NULL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN (
      'undo-bounty-completion',
      'restore-bounty-completion',
      'reassign-bounty-completion'
    )),
    payload TEXT NOT NULL,
    response TEXT NOT NULL
  );
`;

const GUARDS_V8 = `
  CREATE UNIQUE INDEX bounty_claims_one_current_per_offering
    ON bounty_claims(offering_id) WHERE state != 'released';
  CREATE TRIGGER bounty_claims_update_guard BEFORE UPDATE ON bounty_claims
  BEGIN
    SELECT RAISE(ABORT, 'bounty claim snapshot is immutable') WHERE
      NEW.id IS NOT OLD.id OR NEW.offering_id IS NOT OLD.offering_id
      OR NEW.definition_id IS NOT OLD.definition_id OR NEW.member IS NOT OLD.member
      OR NEW.scheduled_on IS NOT OLD.scheduled_on OR NEW.title IS NOT OLD.title
      OR NEW.stars IS NOT OLD.stars OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'invalid bounty claim transition') WHERE
      NEW.revision != OLD.revision + 1 OR NOT (
        (OLD.state = 'unfinished' AND NEW.state IN ('completed', 'released'))
        OR (OLD.state = 'completed' AND NEW.state IN ('completed', 'reopened'))
        OR (OLD.state = 'reopened' AND NEW.state IN ('completed', 'released'))
      );
    SELECT RAISE(ABORT, 'completion does not belong to bounty claim') WHERE
      NEW.effective_completion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM bounty_completions
        WHERE id = NEW.effective_completion_id AND claim_id = NEW.id
      );
    SELECT RAISE(ABORT, 'restorable completion does not belong to bounty claim') WHERE
      NEW.restorable_completion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM bounty_completions
        WHERE id = NEW.restorable_completion_id AND claim_id = NEW.id
      );
    SELECT RAISE(ABORT, 'correction does not match bounty claim state') WHERE
      NEW.correction_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM bounty_completion_corrections x
        WHERE x.id = NEW.correction_id AND x.claim_id = NEW.id
          AND x.completion_id = COALESCE(
            NEW.effective_completion_id,
            NEW.restorable_completion_id
          )
      );
  END;
  CREATE TRIGGER bounty_claims_no_delete BEFORE DELETE ON bounty_claims
    BEGIN SELECT RAISE(ABORT, 'bounty claims cannot be deleted'); END;
  CREATE TRIGGER bounty_completions_no_update BEFORE UPDATE ON bounty_completions
    BEGIN SELECT RAISE(ABORT, 'bounty completions are immutable'); END;
  CREATE TRIGGER bounty_completions_no_delete BEFORE DELETE ON bounty_completions
    BEGIN SELECT RAISE(ABORT, 'bounty completions are immutable'); END;
  CREATE TRIGGER bounty_completion_corrections_no_update
    BEFORE UPDATE ON bounty_completion_corrections
    BEGIN SELECT RAISE(ABORT, 'bounty completion corrections are immutable'); END;
  CREATE TRIGGER bounty_completion_corrections_no_delete
    BEFORE DELETE ON bounty_completion_corrections
    BEGIN SELECT RAISE(ABORT, 'bounty completion corrections are immutable'); END;
  CREATE TRIGGER bounty_correction_receipts_no_update
    BEFORE UPDATE ON bounty_correction_receipts
    BEGIN SELECT RAISE(ABORT, 'bounty correction receipts are immutable'); END;
  CREATE TRIGGER bounty_correction_receipts_no_delete
    BEFORE DELETE ON bounty_correction_receipts
    BEGIN SELECT RAISE(ABORT, 'bounty correction receipts are immutable'); END;
`;

export function migrateBountyLifecycleToV8(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(bounty_claims)").all();
  if (columns.some((column) => column.name === "effective_completion_id"))
    return;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`BEGIN IMMEDIATE;
      DROP TRIGGER IF EXISTS bounty_claims_update_guard;
      DROP TRIGGER IF EXISTS bounty_claims_no_delete;
      DROP TRIGGER IF EXISTS bounty_completions_no_update;
      DROP TRIGGER IF EXISTS bounty_completions_no_delete;
      DROP INDEX IF EXISTS bounty_claims_one_current_per_offering;
      ${CLAIMS_V8}
      ${COMPLETIONS_V8}
      INSERT INTO bounty_completions_v8
        (id, claim_id, request_id, member, completed_at, credited_stars, credit_provenance)
        SELECT id, claim_id, request_id, member, completed_at, credited_stars, 'recorded'
        FROM bounty_completions;
      INSERT INTO bounty_claims_v8
        (id, offering_id, definition_id, member, scheduled_on, title, stars,
         revision, state, effective_completion_id, restorable_completion_id,
         correction_id, created_at)
        SELECT c.id, c.offering_id, c.definition_id, c.member, c.scheduled_on,
          c.title, c.stars, c.revision, c.state,
          CASE WHEN c.state = 'completed' THEN x.id ELSE NULL END,
          NULL, NULL, c.created_at
        FROM bounty_claims c
        LEFT JOIN bounty_completions x ON x.claim_id = c.id;
      DROP TABLE bounty_completions;
      DROP TABLE bounty_claims;
      ALTER TABLE bounty_claims_v8 RENAME TO bounty_claims;
      ALTER TABLE bounty_completions_v8 RENAME TO bounty_completions;
      ${HISTORY_V8}
      ${GUARDS_V8}
      PRAGMA user_version = 8;
    `);
    const foreignKeyError = db.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyError)
      throw new Error("Bounty lifecycle migration broke a foreign key");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
