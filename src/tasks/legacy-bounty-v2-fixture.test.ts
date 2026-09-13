import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import {
  createLegacyBountyV2Fixture,
  legacyFixtureToday,
  readLegacyBountyV2Fixture,
  validateLegacyBountyV2Fixture,
} from "./legacy-bounty-v2-fixture.test-support";
import { migrateTaskAdministration } from "./store-migration";
import { view } from "./view";

test("the legacy fixture is a reopenable version-two database accepted by existing readers", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "familyos-legacy-v2-"));
  const databasePath = path.join(directory, "tasks.sqlite");
  let db: DatabaseSync | null = createLegacyBountyV2Fixture(databasePath);
  try {
    validateLegacyBountyV2Fixture(db);
    db.close();
    db = new DatabaseSync(databasePath);
    validateLegacyBountyV2Fixture(db);

    const legacy = readLegacyBountyV2Fixture(db);
    const current = view(
      legacy.definitions,
      legacy.events,
      legacyFixtureToday(),
    );
    assert.ok(
      current.some(
        (row) =>
          row.task === "legacy-recurring-current-claim" &&
          row.state === "claimed" &&
          row.by === "kid",
      ),
    );
    assert.equal(
      current.some((row) => row.task === "legacy-once-expired"),
      false,
    );

    const before = Number(
      db.prepare("SELECT balance FROM star_balances WHERE member = 'dad'").get()
        ?.balance,
    );
    db.prepare(
      `INSERT INTO events (task, window, kind, by, at, reason)
       VALUES ('legacy-once-open', '2026-09-14', 'completed', 'dad', '2026-09-14T18:00:00Z', NULL)`,
    ).run();
    assert.equal(
      db
        .prepare(
          "SELECT stars FROM completion_credits WHERE task = 'legacy-once-open' AND window = '2026-09-14'",
        )
        .get()?.stars,
      2,
    );
    assert.equal(
      db.prepare("SELECT balance FROM star_balances WHERE member = 'dad'").get()
        ?.balance,
      before + 2,
    );

    migrateTaskAdministration(db);
    validateLegacyBountyV2Fixture(db);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
