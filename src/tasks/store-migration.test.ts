import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { parseTaskAdminCommand } from "./admin-types";
import {
  administerBountyDefinition,
  claimBounty,
  completeBounty,
  createBounty,
  loadAvailableBounties,
  migrateBountyStore,
} from "./bounty-store";
import { migrateTaskAdministration } from "./store-migration";
import {
  parseBountyCommand,
  parseLocalDate,
  parseTaskCreateDraft,
} from "./types";

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
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(8);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'bounty_%'",
        )
        .get()?.count,
    ).toBe(8);
  } finally {
    db.close();
  }
});

test("version-three claims and durable receipts survive the release expansion", () => {
  const db = new DatabaseSync(":memory:");
  const legacyPayload = {
    kind: "claim-bounty",
    requestId: "accepted-v3-claim",
    offering: { kind: "once", definition: "bounty" },
    member: "dad",
  };
  const command = parseBountyCommand(legacyPayload);
  const today = parseLocalDate("2026-09-13");
  const completionCommand = parseBountyCommand({
    kind: "complete-bounty",
    requestId: "accepted-v3-completion",
    claim: "completed-claim",
    revision: 0,
  });
  expect(command?.kind).toBe("claim-bounty");
  expect(today).not.toBeNull();
  if (
    !command ||
    command.kind !== "claim-bounty" ||
    !completionCommand ||
    completionCommand.kind !== "complete-bounty" ||
    !today
  ) {
    throw new Error("invalid test fixture");
  }
  try {
    const response = JSON.stringify({
      status: "accepted",
      result: {
        kind: "claimed",
        claim: {
          id: "claim",
          offering: command.offering,
          member: "dad",
          scheduledOn: today,
          title: "Wash car",
          stars: 5,
          revision: 0,
        },
      },
    });
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE bounty_definitions (creation_order INTEGER PRIMARY KEY, id TEXT UNIQUE, lineage TEXT, title TEXT, type TEXT, recurrence TEXT, stars INTEGER, retired_at TEXT);
      CREATE TABLE bounty_offerings (id TEXT PRIMARY KEY, definition_id TEXT UNIQUE REFERENCES bounty_definitions(id), kind TEXT);
      CREATE TABLE bounty_claims (id TEXT PRIMARY KEY, offering_id TEXT UNIQUE REFERENCES bounty_offerings(id), definition_id TEXT REFERENCES bounty_definitions(id), member TEXT, scheduled_on TEXT, title TEXT, stars INTEGER, revision INTEGER, state TEXT CHECK (state IN ('unfinished', 'completed')), created_at TEXT);
      CREATE TABLE bounty_completions (id TEXT PRIMARY KEY, claim_id TEXT UNIQUE REFERENCES bounty_claims(id), request_id TEXT UNIQUE, member TEXT, completed_at TEXT, credited_stars INTEGER);
      CREATE TABLE bounty_command_receipts (request_id TEXT PRIMARY KEY, kind TEXT CHECK (kind IN ('claim-bounty', 'complete-bounty')), payload TEXT, response TEXT);
      CREATE TRIGGER bounty_claims_update_guard BEFORE UPDATE ON bounty_claims BEGIN SELECT RAISE(ABORT, 'old claim guard'); END;
      CREATE TRIGGER bounty_claims_no_delete BEFORE DELETE ON bounty_claims BEGIN SELECT RAISE(ABORT, 'old claim guard'); END;
      CREATE TRIGGER bounty_receipts_no_update BEFORE UPDATE ON bounty_command_receipts BEGIN SELECT RAISE(ABORT, 'old receipt guard'); END;
      CREATE TRIGGER bounty_receipts_no_delete BEFORE DELETE ON bounty_command_receipts BEGIN SELECT RAISE(ABORT, 'old receipt guard'); END;
      INSERT INTO bounty_definitions VALUES (1, 'bounty', 'lineage', 'Wash car', 'chore', 'once', 5, NULL);
      INSERT INTO bounty_offerings VALUES ('offering', 'bounty', 'once');
      INSERT INTO bounty_claims VALUES ('claim', 'offering', 'bounty', 'dad', '2026-09-13', 'Wash car', 5, 0, 'unfinished', '2026-09-13T12:00:00Z');
      INSERT INTO bounty_definitions VALUES (2, 'completed-bounty', 'completed-lineage', 'Mow lawn', 'chore', 'once', 3, NULL);
      INSERT INTO bounty_offerings VALUES ('completed-offering', 'completed-bounty', 'once');
      INSERT INTO bounty_claims VALUES ('completed-claim', 'completed-offering', 'completed-bounty', 'dad', '2026-09-13', 'Mow lawn', 3, 1, 'completed', '2026-09-13T12:00:00Z');
      INSERT INTO bounty_completions VALUES ('v3-completion', 'completed-claim', 'accepted-v3-completion', 'dad', '2026-09-13T13:00:00Z', 3);
      PRAGMA user_version = 3;
    `);
    db.prepare("INSERT INTO bounty_command_receipts VALUES (?, ?, ?, ?)").run(
      command.requestId,
      command.kind,
      JSON.stringify(legacyPayload),
      response,
    );
    db.prepare("INSERT INTO bounty_command_receipts VALUES (?, ?, ?, ?)").run(
      completionCommand.requestId,
      completionCommand.kind,
      JSON.stringify(completionCommand),
      JSON.stringify({
        status: "accepted",
        result: {
          kind: "completed",
          completion: {
            id: "v3-completion",
            claim: "completed-claim",
            by: "dad",
            at: "2026-09-13T13:00:00Z",
            creditedStars: 3,
          },
        },
      }),
    );

    migrateBountyStore(db);
    migrateBountyStore(db);

    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(8);
    expect(
      db
        .prepare("SELECT revision FROM bounty_definitions WHERE id='bounty'")
        .get()?.revision,
    ).toBe(0);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db.prepare("PRAGMA foreign_key_list(bounty_completions)").get()?.table,
    ).toBe("bounty_claims");
    expect(
      db
        .prepare("PRAGMA table_info(bounty_offerings)")
        .all()
        .some((column) => column.name === "interval_start"),
    ).toBe(true);
    expect(
      claimBounty({
        db,
        command,
        today,
        members: [{ id: "dad", name: "Dad", status: "retired" }],
      }),
    ).toEqual({
      status: "already-applied",
      result: {
        kind: "claimed",
        claim: {
          id: "claim",
          offering: command.offering,
          member: "dad",
          scheduledOn: today,
          title: "Wash car",
          stars: 5,
        },
        revision: 0,
      },
    });
    expect(completeBounty({ db, command: completionCommand })).toEqual({
      status: "already-applied",
      result: {
        kind: "completed",
        completion: {
          id: "v3-completion",
          claim: "completed-claim",
          by: "dad",
          at: "2026-09-13T13:00:00Z",
          creditedStars: 3,
          creditProvenance: "recorded",
        },
      },
    });
    const edit = parseTaskAdminCommand({
      kind: "edit-bounty",
      requestId: "e".repeat(32),
      definition: "bounty",
      revision: 0,
      draft: { title: "Polish car", stars: 8 },
    });
    expect(edit?.kind).toBe("edit-bounty");
    if (!edit || edit.kind !== "edit-bounty") throw new Error("invalid edit");
    expect(
      administerBountyDefinition({ db, command: edit, today }),
    ).toMatchObject({
      status: "accepted",
      definition: { title: "Polish car", revision: 1 },
    });
    expect(
      administerBountyDefinition({ db, command: edit, today }),
    ).toMatchObject({
      status: "already-applied",
      definition: { title: "Polish car" },
    });
    expect(
      db
        .prepare("SELECT title, stars FROM bounty_claims WHERE id='claim'")
        .get(),
    ).toEqual({ title: "Wash car", stars: 5 });

    const recurringDraft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Water plants",
      stars: 2,
      recurrence: {
        kind: "recurring",
        startsOn: "2026-09-14",
        cadence: { kind: "weekly", days: ["mon"] },
      },
    });
    expect(recurringDraft?.kind).toBe("bounty");
    if (!recurringDraft || recurringDraft.kind !== "bounty") {
      throw new Error("invalid recurring fixture");
    }
    const recurring = createBounty(db, recurringDraft, today);
    expect(
      loadAvailableBounties(db, today).some(
        (offering) => offering.offering.definition === recurring.id,
      ),
    ).toBe(false);
    const monday = parseLocalDate("2026-09-14");
    expect(monday).not.toBeNull();
    if (!monday) throw new Error("invalid Monday fixture");
    expect(loadAvailableBounties(db, monday)).toContainEqual(
      expect.objectContaining({
        offering: {
          kind: "recurring",
          definition: recurring.id,
          intervalStart: monday,
        },
      }),
    );
  } finally {
    db.close();
  }
});

test("a corrupt durable Bounty receipt is rejected before replay", () => {
  const db = new DatabaseSync(":memory:");
  try {
    migrateBountyStore(db);
    const legacyPayload = {
      kind: "claim-bounty",
      requestId: "corrupt-receipt-request",
      offering: { kind: "once", definition: "missing-definition" },
      member: "dad",
    };
    const command = parseBountyCommand(legacyPayload);
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
      JSON.stringify(legacyPayload),
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

    expect(() =>
      claimBounty({
        db,
        command,
        today,
        members: [
          {
            id: "dad",
            name: "Dad",
            status: "active",
            color: "#a9d8d2",
          },
        ],
      }),
    ).toThrow("corrupt Bounty command receipt");
  } finally {
    db.close();
  }
});

test("version-six admin receipts replay after activation-bound migration", () => {
  const db = new DatabaseSync(":memory:");
  const today = parseLocalDate("2026-09-13");
  expect(today).not.toBeNull();
  if (!today) return;
  try {
    migrateBountyStore(db);
    const draft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Wash car",
      stars: 4,
      recurrence: { kind: "once" },
    });
    expect(draft?.kind).toBe("bounty");
    if (!draft || draft.kind !== "bounty") return;
    const bounty = createBounty(db, draft, today);
    const command = parseTaskAdminCommand({
      kind: "edit-bounty",
      requestId: "historic-admin-receipt",
      definition: bounty.id,
      revision: 0,
      draft: { title: "Polish car", stars: 6 },
    });
    expect(command?.kind).toBe("edit-bounty");
    if (!command || command.kind !== "edit-bounty") return;
    db.exec(`
      UPDATE bounty_definitions
      SET title = 'Polish car', stars = 6, revision = 1
      WHERE id = '${bounty.id}';
      DROP TRIGGER bounty_admin_receipts_no_update;
      DROP TRIGGER bounty_admin_receipts_no_delete;
      DROP TABLE bounty_admin_command_receipts;
      CREATE TABLE bounty_admin_command_receipts (
        request_id TEXT PRIMARY KEY,
        kind TEXT CHECK (kind IN ('edit-bounty', 'retire-bounty')),
        payload TEXT,
        response TEXT
      );
    `);
    const historicalResponse = {
      ...bounty,
      title: "Polish car",
      stars: 6,
      revision: 1,
    } as Record<string, unknown>;
    delete historicalResponse.offerFrom;
    db.prepare(
      "INSERT INTO bounty_admin_command_receipts VALUES (?, ?, ?, ?)",
    ).run(
      command.requestId,
      command.kind,
      JSON.stringify(command),
      JSON.stringify(historicalResponse),
    );
    db.exec(`
      DROP TRIGGER bounty_definitions_update_guard;
      DROP TRIGGER bounty_definitions_no_delete;
      ALTER TABLE bounty_definitions DROP COLUMN offer_from;
      CREATE TRIGGER bounty_definitions_update_guard BEFORE UPDATE ON bounty_definitions
        BEGIN SELECT 1; END;
      CREATE TRIGGER bounty_definitions_no_delete BEFORE DELETE ON bounty_definitions
        BEGIN SELECT 1; END;
      CREATE TRIGGER bounty_admin_receipts_no_update BEFORE UPDATE ON bounty_admin_command_receipts
        BEGIN SELECT 1; END;
      CREATE TRIGGER bounty_admin_receipts_no_delete BEFORE DELETE ON bounty_admin_command_receipts
        BEGIN SELECT 1; END;
      PRAGMA user_version = 6;
    `);

    migrateBountyStore(db);
    expect(administerBountyDefinition({ db, command, today })).toMatchObject({
      status: "already-applied",
      definition: { id: bounty.id, title: "Polish car", offerFrom: null },
    });
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(7);
  } finally {
    db.close();
  }
});
