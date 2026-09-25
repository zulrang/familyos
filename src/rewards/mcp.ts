import type { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { activeMembers } from "@/members/members";
import { readHousehold } from "@/settings/settings";
import {
  AgentInputError,
  readAnnotations,
  toolResult,
  writeAnnotations,
} from "@/shared/mcp/tools";
import { RewardConflict, rewardsStore } from "./store";

export function registerRewardTools(
  server: McpServer,
  database: () => DatabaseSync,
) {
  server.registerTool(
    "list_rewards",
    {
      description:
        "Read active Rewards with their IDs, current costs and revisions, Reward Goals and Star Balances. Read before confirming a Reward Spend.",
      inputSchema: z.strictObject({}),
      annotations: readAnnotations,
    },
    () =>
      toolResult(() => {
        const snapshot = rewardsStore(database()).snapshot();
        return {
          ...snapshot,
          rewards: snapshot.rewards.filter(
            (reward) => reward.retiredAt === null,
          ),
        };
      }),
  );
  server.registerTool(
    "spend_reward",
    {
      description:
        "Confirm a Reward Spend: deduct Stars for the chosen member and Reward. Only call when the user requests spending; use the revision and cost read from list_rewards. Supply a new UUID requestId; reuse it and identical inputs on retry. This records spending, not delivery or fulfillment.",
      inputSchema: z.strictObject({
        requestId: z.uuid(),
        member: z.string().min(1).max(200),
        reward: z.uuid(),
        revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
      annotations: writeAnnotations,
    },
    (input) =>
      toolResult(async () => {
        const household = await readHousehold();
        if (
          !activeMembers(household.members).some(
            (member) => member.id === input.member,
          )
        )
          throw new AgentInputError(
            "Choose an active member from list_members.",
          );
        try {
          return {
            spend: rewardsStore(database()).apply({
              kind: "spend",
              id: input.requestId,
              member: input.member,
              reward: input.reward,
              revision: input.revision,
            }),
          };
        } catch (error) {
          if (error instanceof RewardConflict)
            throw new AgentInputError(error.message);
          throw error;
        }
      }),
  );
}
