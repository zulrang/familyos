import { expect, test } from "vitest";
import { bountyStarsEarned } from "./bounty-earnings";
import type { ClaimedBounty, Instant } from "./types";

const oldCompletion = {
  id: "old-completion",
  claim: "claim",
  by: "dad",
  at: "2026-09-01T12:00:00Z",
  creditedStars: 4,
  creditProvenance: "recorded",
} as const;

function claim(state: ClaimedBounty["state"]): ClaimedBounty {
  return {
    kind: "claimed-bounty",
    claim: {
      id: "claim",
      offering: { kind: "once", definition: "bounty" },
      member: "dad",
      scheduledOn: "2026-09-01",
      title: "Wash car",
      stars: 4,
    },
    revision: 2,
    state,
  } as ClaimedBounty;
}

const oldRange = {
  from: "2026-09-01T00:00:00Z" as Instant,
  before: "2026-09-02T00:00:00Z" as Instant,
};
const newRange = {
  from: "2026-09-10T00:00:00Z" as Instant,
  before: "2026-09-11T00:00:00Z" as Instant,
};

test("Stars Earned excludes Undo and Restore uses the original completion time", () => {
  const reopened = claim({
    kind: "reopened",
    undoneCompletion: oldCompletion as never,
    correction: "undo" as never,
  });
  expect(bountyStarsEarned([reopened], { ...oldRange, member: "dad" })).toBe(0);

  const restored = claim({
    kind: "completed",
    completion: oldCompletion as never,
    creditedTo: "dad",
    correction: "restore" as never,
  });
  expect(bountyStarsEarned([restored], { ...oldRange, member: "dad" })).toBe(4);
  expect(bountyStarsEarned([restored], { ...newRange, member: "dad" })).toBe(0);
});

test("recompletion uses its new time and reassignment follows the current creditor", () => {
  const recompleted = claim({
    kind: "completed",
    completion: {
      ...oldCompletion,
      id: "new-completion",
      at: "2026-09-10T12:00:00Z",
    } as never,
    creditedTo: "ellie",
    correction: "reassign" as never,
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
    completion: { ...oldCompletion, creditedStars: 0 } as never,
    creditedTo: "dad",
    correction: null,
  });
  expect(bountyStarsEarned([zero], { ...oldRange, member: "dad" })).toBe(0);
});
