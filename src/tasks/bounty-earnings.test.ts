import { expect, test } from "vitest";
import { bountyStarsEarned } from "./bounty-earnings";
import {
  type BountyCompletion,
  type ClaimedBounty,
  parseBountyCommandReceipt,
  parseBountyCorrectionId,
  parseInstant,
} from "./types";

function completion(input: {
  id: string;
  at: string;
  stars: number;
}): BountyCompletion {
  const receipt = parseBountyCommandReceipt({
    status: "accepted",
    result: {
      kind: "completed",
      completion: {
        id: input.id,
        claim: "claim",
        by: "dad",
        at: input.at,
        creditedStars: input.stars,
        creditProvenance: "recorded",
      },
    },
  });
  if (!receipt || !("result" in receipt) || receipt.result.kind !== "completed")
    throw new Error("Invalid completion fixture");
  return receipt.result.completion;
}

const accepted = parseBountyCommandReceipt({
  status: "accepted",
  result: {
    kind: "claimed",
    claim: {
      id: "claim",
      offering: { kind: "once", definition: "bounty" },
      member: "dad",
      scheduledOn: "2026-09-01",
      title: "Wash car",
      stars: 4,
    },
    revision: 2,
  },
});
if (!accepted || !("result" in accepted) || accepted.result.kind !== "claimed")
  throw new Error("Invalid Claim fixture");
const acceptedClaim = accepted.result;
const undo = parseBountyCorrectionId("undo");
const restore = parseBountyCorrectionId("restore");
const reassign = parseBountyCorrectionId("reassign");
if (!undo || !restore || !reassign)
  throw new Error("Invalid correction fixture identity");

const oldCompletion = completion({
  id: "old-completion",
  at: "2026-09-01T12:00:00Z",
  stars: 4,
});

function instant(value: string) {
  const parsed = parseInstant(value);
  if (!parsed) throw new Error("Invalid Instant fixture");
  return parsed;
}

function claim(state: ClaimedBounty["state"]): ClaimedBounty {
  return {
    kind: "claimed-bounty",
    claim: acceptedClaim.claim,
    revision: acceptedClaim.revision,
    state,
  };
}

const oldRange = {
  from: instant("2026-09-01T00:00:00Z"),
  before: instant("2026-09-02T00:00:00Z"),
};
const newRange = {
  from: instant("2026-09-10T00:00:00Z"),
  before: instant("2026-09-11T00:00:00Z"),
};

test("Stars Earned excludes Undo and Restore uses the original completion time", () => {
  const reopened = claim({
    kind: "reopened",
    undoneCompletion: oldCompletion,
    correction: undo,
  });
  expect(bountyStarsEarned([reopened], { ...oldRange, member: "dad" })).toBe(0);

  const restored = claim({
    kind: "completed",
    completion: oldCompletion,
    creditedTo: "dad",
    correction: restore,
  });
  expect(bountyStarsEarned([restored], { ...oldRange, member: "dad" })).toBe(4);
  expect(bountyStarsEarned([restored], { ...newRange, member: "dad" })).toBe(0);
});

test("recompletion uses its new time and reassignment follows the current creditor", () => {
  const recompleted = claim({
    kind: "completed",
    completion: completion({
      id: "new-completion",
      at: "2026-09-10T12:00:00Z",
      stars: 4,
    }),
    creditedTo: "ellie",
    correction: reassign,
  });
  expect(
    bountyStarsEarned([recompleted], { ...oldRange, member: "ellie" }),
  ).toBe(0);
  expect(bountyStarsEarned([recompleted], { ...newRange, member: "dad" })).toBe(
    0,
  );
  expect(
    bountyStarsEarned([recompleted], { ...newRange, member: "ellie" }),
  ).toBe(4);
});

test("zero-Star effective completions report zero", () => {
  const zero = claim({
    kind: "completed",
    completion: completion({
      id: "zero-completion",
      at: "2026-09-01T12:00:00Z",
      stars: 0,
    }),
    creditedTo: "dad",
    correction: null,
  });
  expect(bountyStarsEarned([zero], { ...oldRange, member: "dad" })).toBe(0);
});
