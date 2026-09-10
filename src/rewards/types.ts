import type { ActiveMember } from "@/members/members";

declare const costBrand: unique symbol;
export type StarCost = number & { readonly [costBrand]: true };
export type RewardDraft = {
  name: string;
  description: string;
  cost: StarCost;
  icon: RewardIcon;
};
export const rewardIcons = [
  "star",
  "book-open",
  "utensils",
  "image",
  "moon",
] as const;
export type RewardIcon = (typeof rewardIcons)[number];
export type Reward = RewardDraft & {
  id: string;
  revision: number;
  retiredAt: string | null;
};
export type RewardGoal = { member: string; reward: string };
export type RewardSpend = {
  id: string;
  member: string;
  reward: string;
  revision: number;
  name: string;
  cost: StarCost;
  at: string;
};
export type RewardsRead = {
  familyName: string;
  members: ActiveMember[];
  rewards: Reward[];
  goals: RewardGoal[];
  balances: { member: string; balance: number }[];
};
export type RewardsCommand =
  | { kind: "goal"; member: string; reward: string | null }
  | {
      kind: "spend";
      id: string;
      member: string;
      reward: string;
      revision: number;
    };
export type RewardAdminCommand =
  | { kind: "create"; id: string; draft: RewardDraft }
  | { kind: "edit"; id: string; revision: number; draft: RewardDraft }
  | { kind: "retire"; id: string; revision: number };
export function parseStarCost(raw: unknown): StarCost | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
    ? (raw as StarCost)
    : null;
}
function record(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}
function id(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-f0-9-]{32,36}$/.test(raw);
}
function revision(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0;
}
export function parseRewardDraft(raw: unknown): RewardDraft | null {
  if (!record(raw)) return null;
  const cost = parseStarCost(raw.cost);
  if (
    !cost ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.trim().length > 100 ||
    typeof raw.description !== "string" ||
    raw.description.length > 500 ||
    !rewardIcons.some((icon) => icon === raw.icon)
  )
    return null;
  return {
    name: raw.name.trim(),
    description: raw.description.trim(),
    cost,
    icon: raw.icon as RewardIcon,
  };
}
export function parseRewardsCommand(raw: unknown): RewardsCommand | null {
  if (
    !record(raw) ||
    typeof raw.member !== "string" ||
    !raw.member ||
    raw.member.length > 200
  )
    return null;
  if (raw.kind === "goal" && (raw.reward === null || id(raw.reward)))
    return { kind: "goal", member: raw.member, reward: raw.reward };
  if (
    raw.kind === "spend" &&
    id(raw.id) &&
    id(raw.reward) &&
    revision(raw.revision)
  )
    return {
      kind: "spend",
      id: raw.id,
      member: raw.member,
      reward: raw.reward,
      revision: raw.revision,
    };
  return null;
}
export function parseRewardAdminCommand(
  raw: unknown,
): RewardAdminCommand | null {
  if (!record(raw) || !id(raw.id)) return null;
  if (raw.kind === "retire" && revision(raw.revision))
    return { kind: "retire", id: raw.id, revision: raw.revision };
  const draft = parseRewardDraft(raw.draft);
  if (raw.kind === "create" && draft)
    return { kind: "create", id: raw.id, draft };
  if (raw.kind === "edit" && draft && revision(raw.revision))
    return { kind: "edit", id: raw.id, revision: raw.revision, draft };
  return null;
}
