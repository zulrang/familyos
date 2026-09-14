import {
  activeMembers,
  type HouseholdMember,
  memberById,
} from "@/members/members";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { msToZonedDate } from "@/shared/time";
import { reconcileRetiredMembers } from "./admin-store";
import {
  BountyStoreError,
  claimBounty,
  completeBounty,
  createBounty,
  InactiveBountyMemberError,
  isBountyDefinition,
  loadAvailableBounties,
  loadBountyClaims,
  loadBountyDefinitions,
  releaseBounty,
  taskDefinitions,
} from "./bounty-store";
import {
  applyEvent,
  InvalidTaskDefinitionError,
  insertDefinition,
  loadStore,
  loadStoredStarBalances,
  saveDefinition,
  tasksDatabase,
} from "./store";
import {
  type AssignmentPolicy,
  createDefinition,
  isUnfinishedBountyClaim,
  parseBountyCommand,
  parseEventBatch,
  parseLocalDate,
  parseSaveTaskDraft,
  parseTaskCreateDraft,
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

export async function handleGetTasks(
  request: Request,
  now = new Date(),
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const household = await readHousehold();
  const today = parseLocalDate(
    msToZonedDate(now.getTime(), household.timeZone),
  );
  if (!today) return jsonError("invalid household date", 500);
  reconcileRetiredMembers(household.members, today);
  const { definitions: storedDefinitions, events } = loadStore();
  const db = tasksDatabase();
  const variants = taskDefinitions(
    storedDefinitions,
    loadBountyDefinitions(db),
  );
  const definitions = variants.flatMap((definition) => {
    if (definition.kind === "bounty") return [];
    const { kind: _kind, ...assigned } = definition;
    return [assigned];
  });
  const bountyDefinitions = variants.filter(
    (definition) => definition.kind === "bounty",
  );
  const availableBounties = loadAvailableBounties(db, today);
  const bountyClaims = loadBountyClaims(db).filter(
    (row) =>
      isUnfinishedBountyClaim(row) ||
      (row.state.kind === "completed" &&
        msToZonedDate(
          Date.parse(row.state.completion.at),
          household.timeZone,
        ) === today),
  );
  const occurrences = view(definitions, events, today);
  const progress = activeMembers(household.members).map((member) => {
    const mine = occurrences.filter((row) => row.assignee === member.id);
    const myBounties = bountyClaims.filter(
      (row) => row.claim.member === member.id,
    );
    return {
      member: member.id,
      done:
        mine.filter((row) => row.state === "done").length +
        myBounties.filter((row) => row.state.kind === "completed").length,
      total: mine.length + myBounties.length,
    };
  });
  const body: TasksViewRead = {
    occurrences,
    progress,
    starBalances: loadStoredStarBalances(),
    definitions: definitions.filter(
      (definition) => definition.retiredAt === null,
    ),
    bountyDefinitions: bountyDefinitions.filter(
      (definition) => definition.retiredAt === null,
    ),
    availableBounties,
    bountyClaims,
    today,
    generatedAt: now.toISOString() as TasksViewRead["generatedAt"],
  };
  return Response.json(body);
}

function assignedMembers(assignment: AssignmentPolicy): string[] {
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

export async function handleCreateTask(
  request: Request,
  now = new Date(),
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const draft = parseTaskCreateDraft(await readJson(request));
  if (!draft) return jsonError("invalid body", 400);
  const household = await readHousehold();
  if (draft.kind === "bounty") {
    const today = parseLocalDate(
      msToZonedDate(now.getTime(), household.timeZone),
    );
    if (!today) return jsonError("invalid household date", 500);
    const definition = createBounty(tasksDatabase(), draft, today);
    return Response.json({ definition });
  }
  const { kind: _kind, ...assignedDraft } = draft;
  if (hasInactiveAssignee(assignedDraft.assignment, household.members)) {
    return jsonError("active member required", 400);
  }
  const definition = createDefinition(assignedDraft);
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
  try {
    const { id, ...fields } = draft;
    return Response.json({
      definition: saveDefinition({ id, draft: fields, today }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "task not found") {
      return jsonError("task not found", 404);
    }
    if (error instanceof InvalidTaskDefinitionError) {
      return jsonError(error.message, 400);
    }
    throw error;
  }
}

export async function handlePostTaskEvents(
  request: Request,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const events = parseEventBatch(await readJson(request));
  if (!events) return jsonError("invalid body", 400);
  if (events.some((event) => isBountyDefinition(tasksDatabase(), event.task))) {
    return jsonError("Bounties require the Bounty command path", 409);
  }
  const receipts = events.map(applyEvent);
  return Response.json({ receipts });
}

export async function handleBountyCommand(
  request: Request,
  now = new Date(),
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const command = parseBountyCommand(await readJson(request));
  if (!command) return jsonError("invalid body", 400);
  const household = await readHousehold();
  const today = parseLocalDate(
    msToZonedDate(now.getTime(), household.timeZone),
  );
  if (!today) return jsonError("invalid household date", 500);
  reconcileRetiredMembers(household.members, today);
  try {
    if (command.kind === "claim-bounty") {
      const receipt = claimBounty({
        db: tasksDatabase(),
        command,
        today,
        members: household.members,
      });
      return Response.json({ receipt });
    }
    const receipt =
      command.kind === "complete-bounty"
        ? completeBounty({ db: tasksDatabase(), command })
        : releaseBounty({ db: tasksDatabase(), command });
    return Response.json({ receipt });
  } catch (error) {
    if (error instanceof InactiveBountyMemberError) {
      return jsonError(error.message, 400);
    }
    if (error instanceof BountyStoreError) {
      return jsonError(error.message, 409);
    }
    throw error;
  }
}
