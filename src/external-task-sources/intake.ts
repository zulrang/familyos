import {
  activeMembers,
  type HouseholdMember,
  type MemberId,
} from "@/members/members";
import {
  type AssignedTaskDraft,
  type LocalDate,
  parseCreateTaskDraft,
  parseLocalDate,
  parseLocalTime,
  parseStarAmount,
} from "@/tasks/types";

/**
 * One request from an External Task Source, already translated out of the
 * source's protocol. Text and attributes are the sender's content: they are
 * stored as a Task's words and never interpreted as instructions.
 */
export type ExternalTaskRequest = Readonly<{
  /** Stable within its source; repeated deliveries carry the same ID. */
  id: string;
  transcript: string;
  notes: string | null;
  details: string | null;
  /** Name/value pairs as the sender typed them; names keep their case. */
  attributes: ReadonlyArray<readonly [string, string]>;
}>;

/** Why intake refuses a request. Each is final: resending cannot fix it. */
export type IntakeRefusal =
  | "empty_task"
  | "conflicting_attributes"
  | "unknown_member"
  | "ambiguous_member"
  | "no_default_member"
  | "invalid_date"
  | "invalid_time"
  | "invalid_stars";

export type IntakePlan =
  | Readonly<{ ok: true; draft: AssignedTaskDraft }>
  | Readonly<{ ok: false; refusal: IntakeRefusal }>;

export type IntakeHousehold = Readonly<{
  members: readonly HouseholdMember[];
  defaultMember: MemberId | null;
  today: LocalDate;
}>;

/** Task titles are limited to 500 characters (the MCP draft schema's limit). */
export const TASK_TITLE_LIMIT = 500;

function collapse(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The Task title: the transcript, then any notes and details after " — ",
 * whitespace collapsed and shortened with an ellipsis to the title limit.
 */
export function externalTaskTitle(request: ExternalTaskRequest): string {
  const title = [request.transcript, request.notes, request.details]
    .map(collapse)
    .filter(Boolean)
    .join(" — ");
  if (title.length <= TASK_TITLE_LIMIT) return title;
  let cut = title.slice(0, TASK_TITLE_LIMIT - 1);
  // Never leave half of a surrogate pair before the ellipsis.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

type Attribute =
  | { kind: "absent" }
  | { kind: "present"; value: string }
  | { kind: "conflict" };

/**
 * Attribute names match case-insensitively. Differently-cased copies must
 * agree (ignoring case and surrounding space) or the request is ambiguous.
 */
function attribute(request: ExternalTaskRequest, name: string): Attribute {
  const values = request.attributes
    .filter(([key]) => key.trim().toLowerCase() === name)
    .map(([, value]) => value.trim());
  if (values.length === 0) return { kind: "absent" };
  const distinct = new Set(values.map((value) => value.toLowerCase()));
  return distinct.size === 1
    ? { kind: "present", value: values[0] }
    : { kind: "conflict" };
}

type MemberChoice =
  | { ok: true; member: MemberId }
  | { ok: false; refusal: IntakeRefusal };

/** An exact member ID, else a case-insensitive name; only Active Members. */
export function resolveMember(
  value: string,
  members: readonly HouseholdMember[],
): MemberChoice {
  const byId = members.find((member) => member.id === value);
  if (byId)
    return byId.status === "active"
      ? { ok: true, member: byId.id }
      : { ok: false, refusal: "unknown_member" };
  const name = value.toLowerCase();
  const named = activeMembers([...members]).filter(
    (member) => member.name.trim().toLowerCase() === name,
  );
  if (named.length === 1) return { ok: true, member: named[0].id };
  return {
    ok: false,
    refusal: named.length > 1 ? "ambiguous_member" : "unknown_member",
  };
}

function defaultMember(household: IntakeHousehold): MemberChoice {
  const chosen = household.members.find(
    (member) => member.id === household.defaultMember,
  );
  return chosen?.status === "active"
    ? { ok: true, member: chosen.id }
    : { ok: false, refusal: "no_default_member" };
}

/**
 * Decide the assigned Chore for a request: due once on its `date` (default
 * today), for its `member` (default the household's chosen member), with an
 * optional `time` and `stars`. Other attributes are ignored.
 */
export function planExternalTask(
  request: ExternalTaskRequest,
  household: IntakeHousehold,
): IntakePlan {
  const title = externalTaskTitle(request);
  if (!title) return { ok: false, refusal: "empty_task" };
  const named = {
    member: attribute(request, "member"),
    date: attribute(request, "date"),
    time: attribute(request, "time"),
    stars: attribute(request, "stars"),
  };
  if (Object.values(named).some((value) => value.kind === "conflict"))
    return { ok: false, refusal: "conflicting_attributes" };

  const member =
    named.member.kind === "present"
      ? resolveMember(named.member.value, household.members)
      : defaultMember(household);
  if (!member.ok) return member;

  const date =
    named.date.kind === "present"
      ? parseLocalDate(named.date.value)
      : household.today;
  if (!date) return { ok: false, refusal: "invalid_date" };

  const time =
    named.time.kind === "present" ? parseLocalTime(named.time.value) : null;
  if (named.time.kind === "present" && !time)
    return { ok: false, refusal: "invalid_time" };

  const stars =
    named.stars.kind === "present"
      ? /^\d+$/.test(named.stars.value)
        ? parseStarAmount(Number(named.stars.value))
        : null
      : 0;
  if (stars === null) return { ok: false, refusal: "invalid_stars" };

  // The Tasks slice's own parser decides what a valid assigned Task is.
  const draft = parseCreateTaskDraft({
    title,
    type: "chore",
    recurrence: { kind: "once", date },
    assignment: { kind: "fixed", member: member.member },
    time,
    stars,
  });
  if (!draft || draft.assignment.kind === "open")
    throw new Error("External task intake built an invalid Task draft");
  return { ok: true, draft: { ...draft, assignment: draft.assignment } };
}
