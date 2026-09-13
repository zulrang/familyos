import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { claimBounty, migrateBountyStore } from "./bounty-store";
import { migrateTaskAdministration } from "./store-migration";
import { parseBountyCommand, parseLocalDate } from "./types";

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
    ).toThrow(/retired definition is frozen/);
  } finally {
    db.close();
  }
});

test("version-two assigned Tasks survive the transactional Bounty expansion", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE definitions (creation_order INTEGER PRIMARY KEY, id TEXT UNIQUE, lineage TEXT, title TEXT, type TEXT, recurrence TEXT, assignment TEXT, time TEXT, stars INTEGER, retired_at TEXT);
      CREATE TABLE events (task TEXT, window TEXT, kind TEXT, by TEXT, at TEXT, reason TEXT, PRIMARY KEY (task, window, kind));
      CREATE TABLE star_adjustments (id TEXT PRIMARY KEY, member TEXT, delta INTEGER, reason TEXT, at TEXT);
      CREATE TABLE star_balances (member TEXT PRIMARY KEY, balance INTEGER);
      INSERT INTO definitions VALUES (1, 'assigned', 'lineage', 'Dishes', 'chore', '{"kind":"daily"}', '{"kind":"fixed","member":"a"}', NULL, 3, NULL);
      INSERT INTO star_balances VALUES ('a', 9);
      PRAGMA user_version = 2;
    `);
    migrateBountyStore(db);
    migrateBountyStore(db);
    expect(db.prepare("SELECT title FROM definitions").get()?.title).toBe(
      "Dishes",
    );
    expect(db.prepare("SELECT balance FROM star_balances").get()?.balance).toBe(
      9,
    );
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'bounty_%'",
        )
        .get()?.count,
    ).toBe(5);
  } finally {
    db.close();
  }
});

test("a corrupt durable Bounty receipt is rejected before replay", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateBountyStore(db);
    const command = parseBountyCommand({
      kind: "claim-bounty",
      requestId: "corrupt-receipt-request",
      offering: { kind: "once", definition: "missing-definition" },
      member: "dad",
    });
    const today = parseLocalDate("2026-09-13");
    expect(command).not.toBeNull();
    expect(today).not.toBeNull();
    if (!command || command.kind !== "claim-bounty" || !today) {
      throw new Error("invalid test fixture");
    }
    db.prepare(
      "INSERT INTO bounty_command_receipts (request_id, kind, payload, response) VALUES (?, ?, ?, ?)",
    ).run(
      command.requestId,
      command.kind,
      JSON.stringify(command),
      JSON.stringify({
        status: "accepted",
        result: {
          kind: "claimed",
          claim: {
            id: "claim",
            offering: command.offering,
            member: "dad",
            scheduledOn: today,
            title: "Unsafe reward",
            stars: -1,
            revision: 0,
          },
        },
      }),
    );

    expect(() => claimBounty({ db, command, today })).toThrow(
      "corrupt Bounty command receipt",
    );
  } finally {
    db.close();
  }
});
