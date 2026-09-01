import {
  activeMembers,
  type HouseholdMember,
  type MemberId,
  memberById,
} from "@/members/members";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { msToZonedDate } from "@/shared/time";
import {
  applyEvent,
  insertDefinition,
  loadStore,
  saveDefinition,
} from "./store";
import {
  type AssignmentPolicy,
  createDefinition,
  parseCreateTaskDraft,
  parseEventBatch,
  parseLocalDate,
  parseSaveTaskDraft,
  type TasksViewRead,
} from "./types";
import { starBalances, view } from "./view";

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
  const { definitions, events, adjustments } = loadStore();
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
    starBalances: starBalances(definitions, events, adjustments),
    definitions: definitions.filter(
      (definition) => definition.retiredAt === null,
    ),
    today,
    generatedAt: now.toISOString() as TasksViewRead["generatedAt"],
  };
  return Response.json(body);
}

function assignedMembers(assignment: AssignmentPolicy): MemberId[] {
  return assignment.kind === "fixed"
    ? [assignment.member]
    : assignment.kind === "rotation"
      ? assignment.order
      : [];
}

function hasInactiveAssignee(
  assignment: AssignmentPolicy,
  members: HouseholdMember[],
): boolean {
  return assignedMembers(assignment).some(
    (id) => memberById(members, id)?.status !== "active",
  );
}

export async function handleCreateTask(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const draft = parseCreateTaskDraft(await readJson(request));
  if (!draft) return jsonError("invalid body", 400);
  const household = await readHousehold();
  if (hasInactiveAssignee(draft.assignment, household.members)) {
    return jsonError("active member required", 400);
  }
  const definition = createDefinition(draft);
  insertDefinition(definition);
  return Response.json({ definition });
}

export async function handleSaveTask(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const draft = parseSaveTaskDraft(await readJson(request));
  if (!draft) return jsonError("invalid body", 400);
  const household = await readHousehold();
  if (hasInactiveAssignee(draft.assignment, household.members)) {
    return jsonError("active member required", 400);
  }
  const today = parseLocalDate(msToZonedDate(Date.now(), household.timeZone));
  if (!today) return jsonError("invalid household date", 500);
  const { id, ...fields } = draft;
  const definition = saveDefinition({ id, draft: fields, today });
  if (!definition) return jsonError("task not found", 404);
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
