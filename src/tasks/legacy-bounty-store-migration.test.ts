import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { loadBountyCompletionCorrections } from "./bounty-correction-store";
import {
  claimBounty,
  loadAvailableBounties,
  loadBountyClaims,
  loadBountyDefinitions,
  migrateBountyStore,
  releaseBounty,
} from "./bounty-store";
import { migrateLegacyOpenWork } from "./legacy-bounty-store-migration";
import {
  createLegacyBountyV2Fixture,
  LEGACY_BOUNTY_V2_EXPECTED,
  legacyFixtureToday,
  validateLegacyBountyV2Fixture,
} from "./legacy-bounty-v2-fixture.test-support";
import { parseBountyCommand } from "./types";

test("legacy open work migrates once without changing balances", () => {
  const db = createLegacyBountyV2Fixture();
  try {
    validateLegacyBountyV2Fixture(db);
    const balances = db
      .prepare("SELECT * FROM star_balances ORDER BY member")
      .all();
    migrateBountyStore(db);

    expect(
      migrateLegacyOpenWork({
        db,
        today: legacyFixtureToday(),
        members: LEGACY_BOUNTY_V2_EXPECTED.members,
      }),
    ).toEqual({
      status: "migrated",
      definitions: LEGACY_BOUNTY_V2_EXPECTED.convertToBounty.length,
    });
    expect(
      migrateLegacyOpenWork({
        db,
        today: legacyFixtureToday(),
        members: LEGACY_BOUNTY_V2_EXPECTED.members,
      }),
    ).toEqual({ status: "already-migrated", definitions: 0 });
    expect(
      db.prepare("SELECT * FROM star_balances ORDER BY member").all(),
    ).toEqual(balances);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    expect(loadBountyDefinitions(db).map((row) => row.id)).toEqual(
      LEGACY_BOUNTY_V2_EXPECTED.convertToBounty,
    );
    expect(
      db
        .prepare(
          "SELECT source_task_id FROM legacy_bounty_sources ORDER BY rowid",
        )
        .all(),
    ).toEqual(
      LEGACY_BOUNTY_V2_EXPECTED.convertToBounty.map((source_task_id) => ({
        source_task_id,
      })),
    );
    expect(
      loadAvailableBounties(db, legacyFixtureToday())
        .map((row) => row.offering.definition)
        .sort(),
    ).toEqual(
      [
        ...LEGACY_BOUNTY_V2_EXPECTED.availableOnce,
        ...LEGACY_BOUNTY_V2_EXPECTED.currentRecurringOfferings,
      ].sort(),
    );

    const claims = loadBountyClaims(db);
    for (const expected of LEGACY_BOUNTY_V2_EXPECTED.unfinishedClaims) {
      expect(claims).toContainEqual(
        expect.objectContaining({
          claim: expect.objectContaining({
            member: expected.member,
            scheduledOn: expected.window,
            offering: expect.objectContaining({
              kind: "legacy",
              definition: expected.source,
              sourceWindow: expected.window,
            }),
          }),
          state: expect.objectContaining({
            kind:
              expected.source === "legacy-undone-recorded-claim"
                ? "reopened"
                : "unfinished",
          }),
        }),
      );
    }
    const duplicateIntervalClaims = claims.filter(
      (row) =>
        row.claim.offering.definition === "legacy-recurring-duplicate-claims",
    );
    expect(duplicateIntervalClaims.map((row) => row.claim.offering)).toEqual([
      {
        kind: "legacy",
        definition: "legacy-recurring-duplicate-claims",
        sourceWindow: "2026-09-14",
        intervalStart: "2026-09-14",
      },
      {
        kind: "legacy",
        definition: "legacy-recurring-duplicate-claims",
        sourceWindow: "2026-09-15",
        intervalStart: "2026-09-14",
      },
    ]);
    const staleClaim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: "stale-direct-legacy-claim",
      offering: {
        kind: "recurring",
        definition: "legacy-recurring-duplicate-claims",
        intervalStart: "2026-09-14",
      },
      member: "dad",
      definitionRevision: 0,
    });
    if (!staleClaim || staleClaim.kind !== "claim-bounty")
      throw new Error("invalid stale claim command");
    expect(() =>
      claimBounty({
        db,
        command: staleClaim,
        today: legacyFixtureToday(),
        members: LEGACY_BOUNTY_V2_EXPECTED.members,
      }),
    ).toThrow("This Bounty is no longer available.");
    expect(
      db
        .prepare(
          `SELECT c.source_task_id AS source, c.source_window AS window,
                  c.state, x.credited_stars, x.credit_provenance
           FROM legacy_bounty_completion_carriers c
           JOIN bounty_completions x ON x.subject_id = c.id
           ORDER BY c.source_window`,
        )
        .all(),
    ).toEqual([
      {
        source: "legacy-restored-without-claim",
        window: "2026-09-03",
        state: "completed",
        credited_stars: 4,
        credit_provenance: "recorded",
      },
      {
        source: "legacy-undone-without-claim",
        window: "2026-09-04",
        state: "released",
        credited_stars: 0,
        credit_provenance: "legacy-missing",
      },
      {
        source: "legacy-completed-reassigned",
        window: "2026-09-06",
        state: "completed",
        credited_stars: 5,
        credit_provenance: "recorded",
      },
      {
        source: "legacy-completed-zero-credit",
        window: "2026-09-07",
        state: "completed",
        credited_stars: 0,
        credit_provenance: "recorded",
      },
      {
        source: "legacy-completed-missing-credit",
        window: "2026-09-08",
        state: "completed",
        credited_stars: 0,
        credit_provenance: "legacy-missing",
      },
      {
        source: "legacy-once-completed",
        window: "2026-09-09",
        state: "completed",
        credited_stars: 7,
        credit_provenance: "recorded",
      },
    ]);
    expect(loadBountyCompletionCorrections(db).map((row) => row.id)).toEqual([
      "correction-recorded-claim-to-kid",
      "correction-undo-recorded-claim",
    ]);
  } finally {
    db.close();
  }
});

test("retired legacy claimants use the normal release lifecycle", () => {
  const db = createLegacyBountyV2Fixture();
  try {
    migrateBountyStore(db);
    migrateLegacyOpenWork({
      db,
      today: legacyFixtureToday(),
      members: LEGACY_BOUNTY_V2_EXPECTED.members,
    });

    const released = loadBountyClaims(db).filter(
      (row) => row.state.kind === "released",
    );
    for (const expected of LEGACY_BOUNTY_V2_EXPECTED.releasedClaims) {
      expect(released).toContainEqual(
        expect.objectContaining({
          claim: expect.objectContaining({
            member: expected.member,
            scheduledOn: expected.window,
          }),
        }),
      );
    }
    expect(
      loadAvailableBounties(db, legacyFixtureToday())
        .map((row) => row.offering.definition)
        .sort(),
    ).toEqual(
      [
        ...LEGACY_BOUNTY_V2_EXPECTED.availableOnce,
        ...LEGACY_BOUNTY_V2_EXPECTED.currentRecurringOfferings,
      ].sort(),
    );
  } finally {
    db.close();
  }
});

test("an imported Claim release replays after reopening SQLite", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "familyos-bounty-import-"));
  const databasePath = path.join(directory, "tasks.sqlite");
  let db: DatabaseSync | null = createLegacyBountyV2Fixture(databasePath);
  try {
    migrateBountyStore(db);
    migrateLegacyOpenWork({
      db,
      today: legacyFixtureToday(),
      members: LEGACY_BOUNTY_V2_EXPECTED.members,
    });
    const imported = loadBountyClaims(db).find(
      (row) =>
        row.claim.offering.definition === "legacy-recurring-old-claim" &&
        row.state.kind === "unfinished",
    );
    expect(imported?.claim.offering.kind).toBe("legacy");
    if (!imported) throw new Error("missing imported Claim");
    const command = parseBountyCommand({
      kind: "release-bounty",
      requestId: "release-imported-claim",
      claim: imported.claim.id,
      revision: imported.revision,
    });
    if (!command || command.kind !== "release-bounty")
      throw new Error("invalid release command");
    const accepted = releaseBounty({ db, command });
    expect(accepted.status).toBe("accepted");

    db.close();
    db = new DatabaseSync(databasePath);
    migrateBountyStore(db);
    expect(releaseBounty({ db, command })).toEqual({
      ...accepted,
      status: "already-applied",
    });
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
