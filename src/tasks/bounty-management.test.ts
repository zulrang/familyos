import { expect, test } from "vitest";
import { bountyManagementStatus } from "./bounty-management";
import {
  loadBountyClaims,
  loadBountyDefinitions,
  migrateBountyStore,
} from "./bounty-store";
import { loadLegacyBountyCompletionCarriers } from "./legacy-bounty-carrier-store";
import { migrateLegacyOpenWork } from "./legacy-bounty-store-migration";
import {
  createLegacyBountyV2Fixture,
  LEGACY_BOUNTY_V2_EXPECTED,
  legacyFixtureToday,
} from "./legacy-bounty-v2-fixture.test-support";
import { parseCompletionId, parseInstant, parseLocalDate } from "./types";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Invalid Bounty management fixture");
  return value;
}

test("management status treats only effective work in the current interval as reserved", () => {
  const db = createLegacyBountyV2Fixture();
  try {
    migrateBountyStore(db);
    migrateLegacyOpenWork({
      db,
      today: legacyFixtureToday(),
      members: LEGACY_BOUNTY_V2_EXPECTED.members,
    });
    const definitions = loadBountyDefinitions(db);
    const claims = loadBountyClaims(db);
    const carriers = loadLegacyBountyCompletionCarriers(db);
    const status = (definitionId: string) =>
      bountyManagementStatus({
        definition: required(
          definitions.find((definition) => definition.id === definitionId),
        ),
        claims: claims.filter(
          (row) => row.claim.offering.definition === definitionId,
        ),
        carriers: carriers.filter(
          (carrier) => carrier.definition === definitionId,
        ),
        today: legacyFixtureToday(),
      });

    expect(status("legacy-once-completed")).toBe("Completed");
    expect(status("legacy-undone-without-claim")).toBe("Available");

    const recurring = required(
      definitions.find(
        (definition) => definition.id === "legacy-recurring-old-claim",
      ),
    );
    const completedCarrier = required(
      carriers.find(
        (carrier) => carrier.definition === "legacy-once-completed",
      ),
    );
    const recurringCarrier = {
      ...completedCarrier,
      definition: recurring.id,
      offering: {
        kind: "legacy" as const,
        definition: recurring.id,
        sourceWindow: required(parseLocalDate("2026-09-13")),
        intervalStart: required(parseLocalDate("2026-09-13")),
      },
    };
    expect(
      bountyManagementStatus({
        definition: recurring,
        claims: [],
        carriers: [recurringCarrier],
        today: legacyFixtureToday(),
      }),
    ).toBe("Available");
    expect(
      bountyManagementStatus({
        definition: recurring,
        claims: [],
        carriers: [
          {
            ...recurringCarrier,
            offering: {
              ...recurringCarrier.offering,
              sourceWindow: required(parseLocalDate("2026-09-14")),
              intervalStart: required(parseLocalDate("2026-09-14")),
            },
          },
        ],
        today: legacyFixtureToday(),
      }),
    ).toBe("Completed");

    const duplicateClaims = claims.filter(
      (row) =>
        row.claim.offering.definition === "legacy-recurring-duplicate-claims",
    );
    const unfinished = required(duplicateClaims[1]);
    const completed = required(duplicateClaims[0]);
    if (completed.state.kind !== "unfinished")
      throw new Error("Expected unfinished compatibility Claim");
    const completedRow = {
      ...completed,
      state: {
        kind: "completed" as const,
        completion: {
          id: required(parseCompletionId("management-completion")),
          claim: completed.claim.id,
          by: completed.claim.member,
          at: required(parseInstant("2026-09-14T12:00:00Z")),
          creditedStars: completed.claim.stars,
          creditProvenance: "recorded" as const,
        },
        creditedTo: completed.claim.member,
        correction: null,
      },
    };
    expect(
      bountyManagementStatus({
        definition: required(
          definitions.find(
            (definition) =>
              definition.id === "legacy-recurring-duplicate-claims",
          ),
        ),
        claims: [completedRow, unfinished],
        carriers: [],
        today: legacyFixtureToday(),
      }),
    ).toBe("Claimed");
  } finally {
    db.close();
  }
});
