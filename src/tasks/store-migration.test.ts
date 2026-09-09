import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { migrateTaskAdministration } from "./store-migration";

test("version-one data survives migration; balances start at zero and new credits apply once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE definitions (creation_order INTEGER PRIMARY KEY, id TEXT UNIQUE, lineage TEXT, title TEXT, type TEXT, recurrence TEXT, assignment TEXT, time TEXT, stars INTEGER, retired_at TEXT);
      CREATE TABLE events (task TEXT, window TEXT, kind TEXT, by TEXT, at TEXT, reason TEXT, PRIMARY KEY (task, window, kind));
      CREATE TABLE star_adjustments (id TEXT PRIMARY KEY, member TEXT, delta INTEGER, reason TEXT, at TEXT);
      CREATE TRIGGER definitions_retired_once BEFORE UPDATE ON definitions BEGIN SELECT RAISE(ABORT, 'old trigger'); END;
      INSERT INTO definitions VALUES (1, 'task', 'lineage', 'Dishes', 'chore', '{"kind":"daily"}', '{"kind":"open"}', NULL, 7, NULL);
      INSERT INTO events VALUES ('task', '2026-09-07', 'completed', 'a', '2026-09-07T12:00:00Z', NULL);
      PRAGMA user_version = 1;
    `);
    migrateTaskAdministration(db);
    expect(db.prepare("SELECT * FROM star_balances").all()).toEqual([]);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM events").get()?.count,
    ).toBe(1);
    db.exec(
      "INSERT INTO events VALUES ('task', '2026-09-08', 'completed', 'a', '2026-09-08T12:00:00Z', NULL)",
    );
    expect(
      db.prepare("SELECT balance FROM star_balances WHERE member = 'a'").get()
        ?.balance,
    ).toBe(7);
    db.exec("UPDATE definitions SET stars = 20 WHERE id = 'task'");
    expect(
      db.prepare("SELECT balance FROM star_balances WHERE member = 'a'").get()
        ?.balance,
    ).toBe(7);
    db.exec(
      "INSERT OR IGNORE INTO events VALUES ('task', '2026-09-08', 'completed', 'a', '2026-09-08T12:00:00Z', NULL)",
    );
    migrateTaskAdministration(db);
    expect(
      db.prepare("SELECT balance FROM star_balances WHERE member = 'a'").get()
        ?.balance,
    ).toBe(7);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    db.exec(
      "UPDATE definitions SET retired_at = '2026-09-08' WHERE id = 'task'",
    );
    expect(() =>
      db.exec("UPDATE definitions SET title = 'Changed' WHERE id = 'task'"),
    ).toThrow(/immutable/);
  } finally {
    db.close();
  }
});
