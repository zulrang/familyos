import { readHousehold } from "@/settings/settings";
import { msToZonedDate } from "@/shared/time";
import { reconcileRetiredMembers } from "@/tasks/admin-store";
import {
  createExternalTask,
  externalTaskFor,
} from "@/tasks/external-task-store";
import { parseInstant, parseLocalDate } from "@/tasks/types";
import {
  type ExternalTaskRequest,
  type IntakeRefusal,
  planExternalTask,
} from "./intake";

export type IntakeOutcome =
  | Readonly<{ kind: "created" | "already-created" }>
  | Readonly<{ kind: "refused"; refusal: IntakeRefusal }>;

export async function receiveExternalTask(
  source: string,
  request: ExternalTaskRequest,
  now: Date,
): Promise<IntakeOutcome> {
  const key = { source, request: request.id };
  if (externalTaskFor(key)) return { kind: "already-created" };
  const household = await readHousehold();
  const today = parseLocalDate(
    msToZonedDate(now.getTime(), household.timeZone),
  );
  if (!today) throw new Error("Invalid household date");
  reconcileRetiredMembers(household.members, today);
  const plan = planExternalTask(request, {
    members: household.members,
    defaultMember: household.externalTaskDefaultMember,
    today,
  });
  if (!plan.ok) return { kind: "refused", refusal: plan.refusal };
  const receivedAt = parseInstant(now.toISOString());
  if (!receivedAt) throw new Error("Invalid intake time");
  const receipt = createExternalTask(key, plan.draft, receivedAt);
  return { kind: receipt.status };
}
