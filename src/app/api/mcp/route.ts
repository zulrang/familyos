import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { activeMembers } from "@/members/members";
import { registerRewardTools } from "@/rewards/mcp";
import { readHousehold } from "@/settings/settings";
import { handleMcp } from "@/shared/mcp/http";
import { readAnnotations, toolResult } from "@/shared/mcp/tools";
import { registerTaskTools } from "@/tasks/mcp";
import { tasksDatabase } from "@/tasks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createServer() {
  const server = new McpServer(
    { name: "familyos", version: "1.0.0" },
    {
      instructions:
        "FamilyOS manages one Household. Read members and current state before changing it. Use stable IDs, never infer identities from names. Task dates use the Household Time Zone. Reuse request IDs and payloads after uncertain responses. Reward Spends deduct Stars and do not record delivery.",
    },
  );
  server.registerTool(
    "list_members",
    {
      description:
        "Read active Household Member IDs and names, family name, and Household Time Zone. Members are people, not authenticated accounts.",
      inputSchema: z.strictObject({}),
      annotations: readAnnotations,
    },
    () =>
      toolResult(async () => {
        const household = await readHousehold();
        return {
          familyName: household.familyName,
          timeZone: household.timeZone,
          members: activeMembers(household.members),
        };
      }),
  );
  registerTaskTools(server);
  registerRewardTools(server, tasksDatabase);
  return server;
}

export function POST(request: Request) {
  return handleMcp(request, createServer);
}
export function GET(request: Request) {
  return handleMcp(request, createServer);
}
export function DELETE(request: Request) {
  return handleMcp(request, createServer);
}
