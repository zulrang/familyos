import { activeMembers, memberById } from "@/members/members";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { msToZonedDate } from "@/shared/time";
import { applyEvent, insertDefinition, loadStore } from "./store";
import {
  dailyDefinition,
  parseCreateTaskDraft,
  parseEventBatch,
  parseLocalDate,
  type TasksViewRead,
} from "./types";
import { view } from "./view";

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function handleGetTasks(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const household = await readHousehold();
  const now = new Date();
  const today = parseLocalDate(
    msToZonedDate(now.getTime(), household.timeZone),
  );
  if (!today) return jsonError("invalid household date", 500);
  const { definitions, events } = loadStore();
  const occurrences = view(definitions, events, today);
  const progress = activeMembers(household.members).map((member) => {
    const mine = occurrences.filter((row) => row.assignee === member.id);
    return {
      member: member.id,
      done: mine.filter((row) => row.state === "done").length,
      total: mine.length,
    };
  });
  const body: TasksViewRead = {
    occurrences,
    progress,
    today,
    generatedAt: now.toISOString() as TasksViewRead["generatedAt"],
  };
  return Response.json(body);
}

export async function handleCreateTask(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const draft = parseCreateTaskDraft(await readJson(request));
  if (!draft) return jsonError("invalid body", 400);
  const household = await readHousehold();
  const assignedMembers =
    draft.assignment.kind === "fixed"
      ? [draft.assignment.member]
      : draft.assignment.order;
  if (
    assignedMembers.some(
      (id) => memberById(household.members, id)?.status !== "active",
    )
  ) {
    return jsonError("active member required", 400);
  }
  const definition = dailyDefinition(draft);
  insertDefinition(definition);
  return Response.json({ definition });
}

export async function handlePostTaskEvents(
  request: Request,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const events = parseEventBatch(await readJson(request));
  if (!events) return jsonError("invalid body", 400);
  const receipts = events.map(applyEvent);
  return Response.json({ receipts });
}
