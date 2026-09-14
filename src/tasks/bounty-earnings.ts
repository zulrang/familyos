import type { MemberId } from "@/members/members";
import type { ClaimedBounty, Instant } from "./types";

export type BountyEarningsQuery = Readonly<{
  member: MemberId;
  from: Instant;
  before: Instant;
}>;

/** Sum effective Bounty credits by their completion time in [from, before). */
export function bountyStarsEarned(
  claims: readonly ClaimedBounty[],
  query: BountyEarningsQuery,
): number {
  const from = Date.parse(query.from);
  const before = Date.parse(query.before);
  if (before < from) throw new RangeError("invalid Bounty earnings range");
  let earned = 0;
  for (const claim of claims) {
    if (
      claim.state.kind !== "completed" ||
      claim.state.creditedTo !== query.member
    )
      continue;
    const completedAt = Date.parse(claim.state.completion.at);
    if (completedAt < from || completedAt >= before) continue;
    earned += claim.state.completion.creditedStars;
    if (!Number.isSafeInteger(earned))
      throw new RangeError("Bounty Stars Earned exceeds safe integer range");
  }
  return earned;
}
