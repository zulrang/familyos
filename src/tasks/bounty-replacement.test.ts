import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { parseTaskAdminCommand } from "./admin-types";
import {
  claimBounty,
  completeBounty,
  createBounty,
  loadAvailableBounties,
  loadBountyClaims,
  migrateBountyStore,
  replaceDefinition,
} from "./bounty-store";
import {
  parseBountyCommand,
  parseLocalDate,
  parseTaskCreateDraft,
} from "./types";

function date(raw: string) {
  const parsed = parseLocalDate(raw);
  if (!parsed) throw new Error(`Invalid test date: ${raw}`);
  return parsed;
}

function replaceWithFriday(input: { editedOn: string; startsOn?: string }) {
  const db = new DatabaseSync(":memory:");
  migrateBountyStore(db);
  const editedOn = date(input.editedOn);
  const draft = parseTaskCreateDraft({
    kind: "bounty",
    title: "Bins",
    stars: 2,
    recurrence: { kind: "once" },
  });
  if (!draft || draft.kind !== "bounty") throw new Error("invalid fixture");
  const source = createBounty(db, draft, editedOn);
  const command = parseTaskAdminCommand({
    kind: "replace-definition",
    requestId: crypto.randomUUID(),
    source: {
      kind: "bounty",
      definition: source.id,
      revision: source.revision,
    },
    replacement: {
      kind: "bounty",
      title: "Bins",
      stars: 2,
      recurrence: {
        kind: "recurring",
        startsOn: input.startsOn ?? "2026-09-01",
        cadence: { kind: "weekly", days: ["fri"] },
      },
    },
  });
  if (!command || command.kind !== "replace-definition")
    throw new Error("invalid replacement fixture");
  const receipt = replaceDefinition({
    db,
    command,
    today: editedOn,
    members: [],
  });
  return { db, replacement: receipt.replacement.id };
}

describe("Bounty replacement activation", () => {
  test.each([
    {
      relation: "before",
      editedOn: "2026-09-10",
      firstAvailable: "2026-09-11",
    },
    {
      relation: "on",
      editedOn: "2026-09-11",
      firstAvailable: "2026-09-11",
    },
    {
      relation: "after",
      editedOn: "2026-09-12",
      firstAvailable: "2026-09-18",
    },
  ])("starts on the next matching date when edited $relation Friday", ({
    editedOn,
    firstAvailable,
  }) => {
    const { db, replacement } = replaceWithFriday({ editedOn });
    try {
      expect(
        loadAvailableBounties(db, date(editedOn)).some(
          (offering) => offering.offering.definition === replacement,
        ),
      ).toBe(editedOn === firstAvailable);
      expect(loadAvailableBounties(db, date(firstAvailable))).toContainEqual(
        expect.objectContaining({
          offering: {
            kind: "recurring",
            definition: replacement,
            intervalStart: firstAvailable,
          },
        }),
      );
    } finally {
      db.close();
    }
  });

  test("also waits for a future schedule start", () => {
    const { db, replacement } = replaceWithFriday({
      editedOn: "2026-09-10",
      startsOn: "2026-09-25",
    });
    try {
      expect(
        loadAvailableBounties(db, date("2026-09-11")).some(
          (offering) => offering.offering.definition === replacement,
        ),
      ).toBe(false);
      expect(loadAvailableBounties(db, date("2026-09-25"))).toContainEqual(
        expect.objectContaining({
          offering: expect.objectContaining({ definition: replacement }),
        }),
      );
    } finally {
      db.close();
    }
  });

  test("a completed source interval and its captured reward survive replacement", () => {
    const db = new DatabaseSync(":memory:");
    const today = date("2026-09-11");
    try {
      migrateBountyStore(db);
      db.exec(
        "CREATE TABLE star_balances (member TEXT PRIMARY KEY, balance INTEGER NOT NULL)",
      );
      const draft = parseTaskCreateDraft({
        kind: "bounty",
        title: "Bins",
        stars: 7,
        recurrence: {
          kind: "recurring",
          startsOn: "2026-09-01",
          cadence: { kind: "weekly", days: ["fri"] },
        },
      });
      if (!draft || draft.kind !== "bounty") throw new Error("invalid fixture");
      const source = createBounty(db, draft, today);
      const offering = loadAvailableBounties(db, today)[0];
      const claim = parseBountyCommand({
        kind: "claim-bounty",
        requestId: crypto.randomUUID(),
        offering: offering?.offering,
        member: "dad",
        definitionRevision: offering?.definitionRevision,
      });
      if (!claim || claim.kind !== "claim-bounty")
        throw new Error("invalid claim fixture");
      const claimed = claimBounty({
        db,
        command: claim,
        today,
        members: [
          {
            id: "dad",
            name: "Dad",
            status: "active",
            color: "#a9d8d2",
          },
        ],
      });
      if (!("result" in claimed) || claimed.result.kind !== "claimed")
        throw new Error("claim failed");
      const completion = parseBountyCommand({
        kind: "complete-bounty",
        requestId: crypto.randomUUID(),
        claim: claimed.result.claim.id,
        revision: claimed.result.revision,
      });
      if (!completion || completion.kind !== "complete-bounty")
        throw new Error("invalid completion fixture");
      completeBounty({ db, command: completion });

      const replacement = parseTaskAdminCommand({
        kind: "replace-definition",
        requestId: crypto.randomUUID(),
        source: {
          kind: "bounty",
          definition: source.id,
          revision: source.revision,
        },
        replacement: {
          kind: "bounty",
          title: "Bins tomorrow",
          stars: 10,
          recurrence: {
            kind: "recurring",
            startsOn: today,
            cadence: { kind: "daily" },
          },
        },
      });
      if (!replacement || replacement.kind !== "replace-definition")
        throw new Error("invalid replacement fixture");
      replaceDefinition({ db, command: replacement, today, members: [] });

      expect(loadBountyClaims(db)).toContainEqual(
        expect.objectContaining({
          claim: expect.objectContaining({
            offering: expect.objectContaining({ definition: source.id }),
            title: "Bins",
            stars: 7,
          }),
          state: expect.objectContaining({
            kind: "completed",
            completion: expect.objectContaining({ creditedStars: 7 }),
          }),
        }),
      );
    } finally {
      db.close();
    }
  });
});
