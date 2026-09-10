import type { DatabaseSync } from "node:sqlite";
import { activeMembers } from "@/members/members";
import { readHousehold } from "@/settings/settings";
import { adminJson, requireAdmin } from "@/shared/admin-auth";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { RewardConflict, rewardsStore } from "./store";
import { parseRewardAdminCommand, parseRewardsCommand } from "./types";

export async function handleRewards(
  request: Request,
  database: () => DatabaseSync,
  admin = false,
): Promise<Response> {
  if (admin) {
    const denied = requireAdmin(request);
    if (denied) return denied;
  } else {
    const display = await requireTrustedDisplay(request);
    if (isUnauthorized(display)) return display;
    if (
      request.method !== "GET" &&
      request.headers.get("origin") !==
        `${new URL(request.url).protocol}//${request.headers.get("host") ?? new URL(request.url).host}`
    )
      return adminJson({ error: "Same-origin request required." }, 403);
  }
  const household = await readHousehold();
  const store = rewardsStore(database());
  if (request.method === "GET") {
    const snapshot = store.snapshot();
    const members = activeMembers(household.members);
    return adminJson({
      familyName: household.familyName,
      members,
      ...snapshot,
      rewards: admin
        ? snapshot.rewards
        : snapshot.rewards.filter((r) => !r.retiredAt),
      goals: snapshot.goals.filter((g) =>
        members.some((m) => m.id === g.member),
      ),
    });
  }
  const raw: unknown = await request.json().catch(() => null);
  try {
    if (admin) {
      const command = parseRewardAdminCommand(raw);
      if (!command)
        return adminJson(
          { error: "Check the reward fields and try again." },
          400,
        );
      store.administer(command);
      return adminJson({ ok: true });
    }
    const command = parseRewardsCommand(raw);
    if (!command) return adminJson({ error: "Invalid reward choice." }, 400);
    if (!activeMembers(household.members).some((m) => m.id === command.member))
      return adminJson({ error: "Choose an active member." }, 400);
    return adminJson({ spend: store.apply(command) });
  } catch (error) {
    if (error instanceof RewardConflict)
      return adminJson({ error: error.message }, 409);
    throw error;
  }
}
