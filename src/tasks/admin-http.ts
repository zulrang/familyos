import { memberById } from "@/members/members";
import { readHousehold } from "@/settings/settings";
import { adminJson, requireAdmin } from "@/shared/admin-auth";
import { msToZonedDate } from "@/shared/time";
import {
  adjustAdminStars,
  correctAdminCompletion,
  createAdminTask,
  editAdminTask,
  reconcileRetiredMembers,
  retireAdminTask,
  TaskAdminError,
} from "./admin-store";
import { parseTaskAdminCommand } from "./admin-types";
import {
  BountyCorrectionStoreError,
  correctBountyCompletion,
  loadBountyCompletionCorrections,
} from "./bounty-correction-store";
import {
  administerBountyDefinition,
  BountyAdminStoreError,
  InactiveBountyMemberError,
  loadBountyClaims,
  loadBountyCompletions,
  loadBountyDefinitions,
  replaceDefinition,
} from "./bounty-store";
import {
  correctLegacyBountyCompletion,
  LegacyBountyCarrierStoreError,
  loadLegacyBountyCompletionCarriers,
} from "./legacy-bounty-carrier-store";
import {
  loadCompletionCorrections,
  loadEvents,
  loadLegacyBountyArchiveEvents,
  loadStore,
  loadStoredStarBalances,
  tasksDatabase,
} from "./store";
import { nowInstant, parseLocalDate } from "./types";

export async function reconcileHouseholdTasks() {
  const household = await readHousehold();
  const today = parseLocalDate(msToZonedDate(Date.now(), household.timeZone));
  if (!today) throw new Error("Invalid household date");
  reconcileRetiredMembers(household.members, today);
}

export async function handleAdminTasks(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const household = await readHousehold();
  const today = parseLocalDate(msToZonedDate(Date.now(), household.timeZone));
  if (!today) return adminJson({ error: "Invalid household date." }, 500);
  reconcileRetiredMembers(household.members, today);
  if (request.method === "GET") {
    const store = loadStore();
    const db = tasksDatabase();
    return adminJson({
      ...store,
      bountyDefinitions: loadBountyDefinitions(db),
      bountyClaims: loadBountyClaims(db),
      bountyCompletions: loadBountyCompletions(db),
      bountyCompletionCorrections: loadBountyCompletionCorrections(db),
      legacyBountyCompletionCarriers: loadLegacyBountyCompletionCarriers(db),
      originalEvents: loadEvents(),
      legacyBountyArchiveEvents: loadLegacyBountyArchiveEvents(),
      corrections: loadCompletionCorrections(),
      balances: loadStoredStarBalances(),
      today,
    });
  }
  const command = parseTaskAdminCommand(await request.json().catch(() => null));
  if (!command)
    return adminJson({ error: "Check the task fields and try again." }, 400);
  const assignedDraft =
    command.kind === "create" || command.kind === "edit" ? command.draft : null;
  if (assignedDraft) {
    const assignment = assignedDraft.assignment;
    const assigned =
      assignment.kind === "fixed"
        ? [assignment.member]
        : assignment.kind === "rotation"
          ? assignment.order
          : [];
    if (
      assigned.some(
        (id) => memberById(household.members, id)?.status !== "active",
      )
    )
      return adminJson({ error: "Assign tasks only to active members." }, 400);
  }
  if (
    command.kind === "adjust-stars" &&
    !memberById(household.members, command.member)
  )
    return adminJson({ error: "Member not found." }, 400);
  if (
    command.kind === "correct" &&
    command.correction.by &&
    !memberById(household.members, command.correction.by)
  )
    return adminJson({ error: "Member not found." }, 400);
  try {
    switch (command.kind) {
      case "create":
        return adminJson({
          definition: createAdminTask(command.id, command.draft),
        });
      case "edit":
        return adminJson({
          definition: editAdminTask(command.task, command.draft, today),
        });
      case "retire":
        retireAdminTask(command.task, today);
        break;
      case "edit-bounty":
      case "retire-bounty":
      case "create-bounty":
        return adminJson({
          receipt: administerBountyDefinition({
            db: tasksDatabase(),
            command,
            today,
          }),
        });
      case "undo-bounty-completion":
      case "restore-bounty-completion":
      case "reassign-bounty-completion":
        return adminJson({
          receipt: correctBountyCompletion({
            db: tasksDatabase(),
            command,
            members: household.members,
          }),
        });
      case "undo-legacy-bounty-completion":
      case "reassign-legacy-bounty-completion":
        return adminJson({
          receipt: correctLegacyBountyCompletion({
            db: tasksDatabase(),
            command,
            members: household.members,
          }),
        });
      case "replace-definition":
        return adminJson({
          receipt: replaceDefinition({
            db: tasksDatabase(),
            command,
            today,
            members: household.members,
          }),
        });
      case "correct":
        correctAdminCompletion({ ...command.correction, at: nowInstant() });
        break;
      case "adjust-stars":
        adjustAdminStars({ ...command, at: nowInstant() });
        break;
    }
    return adminJson({ ok: true });
  } catch (error) {
    if (error instanceof InactiveBountyMemberError)
      return adminJson({ error: error.message }, 400);
    if (
      error instanceof TaskAdminError ||
      error instanceof BountyAdminStoreError ||
      error instanceof BountyCorrectionStoreError ||
      error instanceof LegacyBountyCarrierStoreError
    )
      return adminJson({ error: error.message }, 409);
    throw error;
  }
}
