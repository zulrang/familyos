import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { migrateBountyStore } from "./bounty-store";
import {
  correctLegacyBountyCompletion,
  LegacyBountyCarrierStoreError,
  loadLegacyBountyCompletionCarriers,
} from "./legacy-bounty-carrier-store";
import {
  type LegacyBountyCompletionCorrectionCommand,
  parseLegacyBountyCompletionCorrectionCommand,
} from "./legacy-bounty-carrier-types";
import { migrateLegacyOpenWork } from "./legacy-bounty-store-migration";
import {
  createLegacyBountyV2Fixture,
  LEGACY_BOUNTY_V2_EXPECTED,
  legacyFixtureToday,
} from "./legacy-bounty-v2-fixture.test-support";

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function migratedFixture(path?: string): DatabaseSync {
  const db = createLegacyBountyV2Fixture(path);
  databases.push(db);
  migrateBountyStore(db);
  migrateLegacyOpenWork({
    db,
    today: legacyFixtureToday(),
    members: LEGACY_BOUNTY_V2_EXPECTED.members,
  });
  return db;
}

function carrierCommand(
  carrier: ReturnType<typeof loadLegacyBountyCompletionCarriers>[number],
  raw: Readonly<{
    kind: "undo-legacy-bounty-completion" | "reassign-legacy-bounty-completion";
    requestId: string;
    reason: string;
    member?: string;
  }>,
): LegacyBountyCompletionCorrectionCommand {
  if (carrier.state.kind !== "completed")
    throw new Error("test carrier is not completed");
  const parsed = parseLegacyBountyCompletionCorrectionCommand({
    ...raw,
    carrier: carrier.id,
    revision: carrier.revision,
    completion: carrier.state.effectiveCompletion.id,
    predecessor: carrier.state.correction,
  });
  if (!parsed) throw new Error("invalid carrier command fixture");
  return parsed;
}

function findCarrier(db: DatabaseSync, sourceTask: string) {
  const carrier = loadLegacyBountyCompletionCarriers(db).find(
    (row) => row.sourceTask === sourceTask,
  );
  if (!carrier) throw new Error(`missing carrier ${sourceTask}`);
  return carrier;
}

test("loads restored legacy history and the mapped Bounty's current title", () => {
  const db = migratedFixture();
  db.prepare(
    `UPDATE bounty_definitions
     SET title = 'Organize loft', revision = revision + 1
     WHERE id = 'legacy-restored-without-claim'`,
  ).run();
  const carrier = findCarrier(db, "legacy-restored-without-claim");

  expect(carrier).toMatchObject({
    kind: "legacy-bounty-completion-carrier",
    sourceTask: "legacy-restored-without-claim",
    sourceWindow: "2026-09-03",
    definition: "legacy-restored-without-claim",
    title: "Organize loft",
    revision: 2,
    state: {
      kind: "completed",
      creditedTo: "kid",
      effectiveCompletion: {
        by: "dad",
        at: "2026-09-03T14:00:00Z",
        creditedStars: 4,
        creditProvenance: "recorded",
      },
      correction: "correction-restore-carrier-to-kid",
    },
  });
  expect(carrier.history.map((row) => row.kind)).toEqual(["undo", "restore"]);
});

test("Undo reverses the actual creditor once and replays after reopening SQLite", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "familyos-carrier-"));
  const databasePath = path.join(directory, "tasks.sqlite");
  let db: DatabaseSync | null = migratedFixture(databasePath);
  try {
    const carrier = findCarrier(db, "legacy-restored-without-claim");
    const command = carrierCommand(carrier, {
      kind: "undo-legacy-bounty-completion",
      requestId: "undo-restored-carrier",
      reason: "Imported completion was mistaken",
    });
    const accepted = correctLegacyBountyCompletion({
      db,
      command,
      members: LEGACY_BOUNTY_V2_EXPECTED.members,
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      result: {
        kind: "legacy-bounty-completion-undone",
        carrier: carrier.id,
        revision: 3,
      },
    });
    expect(
      db
        .prepare("SELECT balance FROM star_balances WHERE member = 'kid'")
        .get(),
    ).toEqual({ balance: 5 });
    expect(findCarrier(db, carrier.sourceTask).state).toMatchObject({
      kind: "released",
      undoneCompletion: {
        at: "2026-09-03T14:00:00Z",
        creditedStars: 4,
      },
    });

    db.close();
    databases.splice(databases.indexOf(db), 1);
    db = new DatabaseSync(databasePath);
    databases.push(db);
    migrateBountyStore(db);
    expect(
      correctLegacyBountyCompletion({
        db,
        command,
        members: [],
      }),
    ).toEqual({ ...accepted, status: "already-applied" });
    expect(
      db
        .prepare("SELECT balance FROM star_balances WHERE member = 'kid'")
        .get(),
    ).toEqual({ balance: 5 });
  } finally {
    if (db && databases.includes(db)) {
      db.close();
      databases.splice(databases.indexOf(db), 1);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Undo rejects a negative balance without changing carrier history", () => {
  const db = migratedFixture();
  const carrier = findCarrier(db, "legacy-once-completed");
  db.prepare("UPDATE star_balances SET balance = 3 WHERE member = 'dad'").run();
  const command = carrierCommand(carrier, {
    kind: "undo-legacy-bounty-completion",
    requestId: "undo-insufficient-carrier",
    reason: "Should remain completed",
  });

  expect(() =>
    correctLegacyBountyCompletion({
      db,
      command,
      members: LEGACY_BOUNTY_V2_EXPECTED.members,
    }),
  ).toThrow(LegacyBountyCarrierStoreError);
  expect(findCarrier(db, carrier.sourceTask)).toEqual(carrier);
  expect(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM legacy_bounty_correction_receipts WHERE request_id = ?",
      )
      .get(command.requestId),
  ).toEqual({ count: 0 });
});

test("Reassign transfers actual credit to an existing retired member", () => {
  const db = migratedFixture();
  const carrier = findCarrier(db, "legacy-completed-reassigned");
  const command = carrierCommand(carrier, {
    kind: "reassign-legacy-bounty-completion",
    requestId: "reassign-carrier-to-former",
    member: "former",
    reason: "Former member did this work",
  });

  const receipt = correctLegacyBountyCompletion({
    db,
    command,
    members: LEGACY_BOUNTY_V2_EXPECTED.members,
  });

  expect(receipt).toMatchObject({
    status: "accepted",
    result: {
      kind: "legacy-bounty-completion-reassigned",
      carrier: carrier.id,
      revision: 2,
    },
  });
  expect(findCarrier(db, carrier.sourceTask)).toMatchObject({
    state: {
      kind: "completed",
      creditedTo: "former",
      effectiveCompletion: {
        by: "dad",
        at: "2026-09-06T15:00:00Z",
        creditedStars: 5,
      },
    },
    history: [
      { kind: "reassign", fromMember: "dad", toMember: "kid" },
      { kind: "reassign", fromMember: "kid", toMember: "former" },
    ],
  });
  expect(
    db
      .prepare("SELECT member, balance FROM star_balances ORDER BY member")
      .all(),
  ).toEqual([
    { member: "dad", balance: 9 },
    { member: "former", balance: 5 },
    { member: "kid", balance: 4 },
  ]);
});

test("a durable request identity cannot be reused for another carrier command", () => {
  const db = migratedFixture();
  const first = findCarrier(db, "legacy-completed-zero-credit");
  const firstCommand = carrierCommand(first, {
    kind: "undo-legacy-bounty-completion",
    requestId: "one-carrier-correction",
    reason: "Undo the zero-credit record",
  });
  correctLegacyBountyCompletion({
    db,
    command: firstCommand,
    members: LEGACY_BOUNTY_V2_EXPECTED.members,
  });
  const second = findCarrier(db, "legacy-once-completed");
  const conflictingCommand = carrierCommand(second, {
    kind: "undo-legacy-bounty-completion",
    requestId: "one-carrier-correction",
    reason: "A different correction",
  });

  expect(() =>
    correctLegacyBountyCompletion({
      db,
      command: conflictingCommand,
      members: LEGACY_BOUNTY_V2_EXPECTED.members,
    }),
  ).toThrow("request identity has already been used");
  expect(findCarrier(db, second.sourceTask)).toEqual(second);
});
