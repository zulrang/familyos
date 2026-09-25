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
import { msToZonedDate } from "@/shared/time";
import {
  reconcileRetiredMembers,
  TaskAdminError,
  writeAgentTask,
} from "./admin-store";
import {
  dateSchema,
  draftSchema,
  memberSchema,
  taskIdSchema,
} from "./mcp-schema";
import { applyEvent, loadStore, taskTransaction } from "./store";
import { readTasksView } from "./tasks-http";
import { nowInstant, parseLocalDate } from "./types";
import { view } from "./view";

async function taskContext() {
  const household = await readHousehold();
  const today = parseLocalDate(msToZonedDate(Date.now(), household.timeZone));
  if (!today) throw new Error("Invalid household date");
  reconcileRetiredMembers(household.members, today);
  return { today, members: activeMembers(household.members) };
}

export function registerTaskTools(server: McpServer) {
  server.registerTool(
    "list_tasks",
    {
      description:
        "Read assigned Task definitions, current Occurrences (including exact task/window IDs), Bounty offerings and claims, progress and Star Balances. Dates use the Household Time Zone. Bounty mutations are not available through these tools.",
      inputSchema: z.strictObject({}),
      annotations: readAnnotations,
    },
    () => toolResult(() => readTasksView()),
  );

  const write = async (command: Parameters<typeof writeAgentTask>[0]) => {
    const { today, members } = await taskContext();
    const assignment = command.draft.assignment;
    const ids =
      assignment.kind === "fixed" ? [assignment.member] : assignment.order;
    if (ids.some((id) => !members.some((member) => member.id === id))) {
      throw new AgentInputError(
        "Assign tasks only to active members from list_members.",
      );
    }
    try {
      return writeAgentTask(command, today);
    } catch (error) {
      if (error instanceof TaskAdminError)
        throw new AgentInputError(error.message);
      throw error;
    }
  };
  server.registerTool(
    "create_task",
    {
      description:
        "Create an assigned Chore or Routine. Use member IDs from list_members. Supply a new UUID requestId and reuse it with identical inputs on retry. time is HH:mm or null; stars may be zero.",
      inputSchema: z.strictObject({ requestId: z.uuid(), draft: draftSchema }),
      annotations: writeAnnotations,
    },
    (input) => toolResult(() => write({ kind: "create", ...input })),
  );
  server.registerTool(
    "edit_task",
    {
      description:
        "Edit an assigned Task using its current ID from list_tasks and a complete replacement draft. Preserve fields not requested to change. Changing assignment or recurrence may return a new Task ID. Reuse the same UUID requestId and inputs on retry.",
      inputSchema: z.strictObject({
        requestId: z.uuid(),
        task: taskIdSchema,
        draft: draftSchema,
      }),
      annotations: writeAnnotations,
    },
    (input) => toolResult(() => write({ kind: "edit", ...input })),
  );
  server.registerTool(
    "complete_task",
    {
      description:
        "Check off an assigned Task Occurrence and credit its Stars once. First read list_tasks; copy the exact task and window, and supply the active completing member ID. Repeat calls for the same occurrence/member do not award extra Stars. Does not complete Bounties.",
      inputSchema: z.strictObject({
        task: taskIdSchema,
        window: dateSchema,
        member: memberSchema,
      }),
      annotations: writeAnnotations,
    },
    (input) =>
      toolResult(async () => {
        const { today, members } = await taskContext();
        if (!members.some((member) => member.id === input.member))
          throw new AgentInputError(
            "Choose an active member from list_members.",
          );
        return taskTransaction(() => {
          const { definitions, events } = loadStore();
          const row = view(definitions, events, today).find(
            (row) => row.task === input.task && row.window === input.window,
          );
          if (!row || row.state === "expired" || row.state === "skipped")
            throw new AgentInputError(
              "This occurrence is not available. Refresh list_tasks before completing it.",
            );
          if (row.state === "done") {
            if (row.by !== input.member)
              throw new AgentInputError(
                "This occurrence was completed by another member.",
              );
            return {
              status: "already-present",
              task: input.task,
              window: input.window,
            };
          }
          return applyEvent({
            kind: "completed",
            task: input.task,
            window: input.window,
            by: input.member,
            at: nowInstant(),
          });
        });
      }),
  );
}
