import type { DatabaseSync } from "node:sqlite";

/** ADR 0007: stored balances start at zero; historical completions are not backfilled. */
export function migrateTaskAdministration(db: DatabaseSync) {
  if (Number(db.prepare("PRAGMA user_version").get()?.user_version) >= 2)
    return;
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE star_balances (
      member TEXT PRIMARY KEY,
      balance INTEGER NOT NULL CHECK (balance >= 0 AND balance <= 9007199254740991)
    );
    CREATE TABLE completion_credits (
      task TEXT NOT NULL, window TEXT NOT NULL, stars INTEGER NOT NULL,
      PRIMARY KEY (task, window)
    );
    CREATE TABLE completion_corrections (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE, task TEXT NOT NULL, window TEXT NOT NULL,
      by TEXT, reason TEXT NOT NULL, at TEXT NOT NULL, previous TEXT
    );
    CREATE TRIGGER corrections_no_update BEFORE UPDATE ON completion_corrections
      BEGIN SELECT RAISE(ABORT, 'corrections are append-only'); END;
    CREATE TRIGGER corrections_no_delete BEFORE DELETE ON completion_corrections
      BEGIN SELECT RAISE(ABORT, 'corrections are append-only'); END;
    CREATE TRIGGER credits_no_update BEFORE UPDATE ON completion_credits
      BEGIN SELECT RAISE(ABORT, 'credits are immutable'); END;
    CREATE TRIGGER credits_no_delete BEFORE DELETE ON completion_credits
      BEGIN SELECT RAISE(ABORT, 'credits are immutable'); END;
    CREATE TRIGGER credit_completion AFTER INSERT ON events WHEN NEW.kind = 'completed'
    BEGIN
      INSERT INTO completion_credits (task, window, stars)
        VALUES (NEW.task, NEW.window, COALESCE((SELECT stars FROM definitions WHERE id = NEW.task), 0));
      INSERT INTO star_balances (member, balance)
        VALUES (NEW.by, (SELECT stars FROM completion_credits WHERE task = NEW.task AND window = NEW.window))
        ON CONFLICT(member) DO UPDATE SET balance = balance + excluded.balance;
    END;
    CREATE TRIGGER apply_star_adjustment AFTER INSERT ON star_adjustments
    BEGIN
      SELECT RAISE(ABORT, 'adjustment must be nonzero') WHERE NEW.delta = 0;
      INSERT INTO star_balances (member, balance) VALUES (NEW.member, 0) ON CONFLICT DO NOTHING;
      UPDATE star_balances SET balance = balance + NEW.delta WHERE member = NEW.member;
    END;
    DROP TRIGGER definitions_retired_once;
    CREATE TRIGGER definitions_retired_once BEFORE UPDATE ON definitions
    BEGIN
      SELECT RAISE(ABORT, 'immutable except retiredAt and editable fields') WHERE
        NEW.creation_order IS NOT OLD.creation_order OR NEW.id IS NOT OLD.id
        OR NEW.lineage IS NOT OLD.lineage OR NEW.recurrence IS NOT OLD.recurrence
        OR NEW.assignment IS NOT OLD.assignment OR OLD.retired_at IS NOT NULL
        OR (NEW.retired_at IS NOT NULL AND (
          NEW.title IS NOT OLD.title OR NEW.type IS NOT OLD.type
          OR NEW.time IS NOT OLD.time OR NEW.stars IS NOT OLD.stars));
    END;
    PRAGMA user_version = 2;
    COMMIT;
  `);
}
