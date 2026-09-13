import type { MemberId } from "@/members/members";
import {
  type BountyRecurrence,
  parseBountyRecurrence,
} from "./bounty-calendar";
import {
  type DayOfMonth,
  type LocalDate,
  parseDayOfMonth,
  parseLocalDate,
  parseWeekday,
  type Weekday,
} from "./calendar-values";

export {
  addLocalDays,
  type DayOfMonth,
  type LocalDate,
  parseDayOfMonth,
  parseLocalDate,
  parseWeekday,
  type Weekday,
} from "./calendar-values";

type Brand<T, B extends string> = T & { readonly __brand: B };

export type TaskId = Brand<string, "TaskId">;
export type LineageId = Brand<string, "LineageId">;
export type OfferingId = Brand<string, "OfferingId">;
export type ClaimId = Brand<string, "ClaimId">;
export type CompletionId = Brand<string, "CompletionId">;
export type BountyCommandId = Brand<string, "BountyCommandId">;
export type StarAmount = Brand<number, "StarAmount">;
export type DefinitionRevision = Brand<number, "DefinitionRevision">;
export type ClaimRevision = Brand<number, "ClaimRevision">;
export type TaskTitle = Brand<string, "TaskTitle">;
export type LocalTime = Brand<string, "LocalTime">;
export type Instant = Brand<string, "Instant">;

export type NonEmpty<T> = [T, ...T[]];

export type TaskType = "chore" | "routine";

export type Recurrence =
  | { kind: "once"; date: LocalDate }
  | { kind: "daily" }
  | { kind: "weekly"; days: NonEmpty<Weekday> }
  | { kind: "monthly"; day: DayOfMonth };

export type AssignmentPolicy =
  | { kind: "fixed"; member: MemberId }
  | { kind: "rotation"; order: NonEmpty<MemberId> }
  | { kind: "open" };

export type LegacyTaskDefinition = {
  id: TaskId;
  lineage: LineageId;
  title: string;
  type: TaskType;
  recurrence: Recurrence;
  assignment: AssignmentPolicy;
  time: LocalTime | null;
  stars: number;
  retiredAt: LocalDate | null;
};

export type AssignedTaskDefinition = Readonly<
  { kind: "assigned" } & LegacyTaskDefinition
>;

export type BountyDefinition = Readonly<{
  kind: "bounty";
  id: TaskId;
  lineage: LineageId;
  type: "chore";
  title: TaskTitle;
  stars: StarAmount;
  recurrence: BountyRecurrence;
  offerFrom: LocalDate | null;
  revision: DefinitionRevision;
  retiredAt: LocalDate | null;
}>;

export type TaskDefinition = AssignedTaskDefinition | BountyDefinition;

export type OfferingKey =
  | Readonly<{ kind: "once"; definition: TaskId }>
  | Readonly<{
      kind: "recurring";
      definition: TaskId;
      intervalStart: LocalDate;
    }>;

export type AvailableBounty = Readonly<{
  kind: "available";
  id: OfferingId;
  offering: OfferingKey;
  title: TaskTitle;
  stars: StarAmount;
  definitionRevision: DefinitionRevision;
}>;

export type BountyClaim = Readonly<{
  id: ClaimId;
  offering: OfferingKey;
  member: MemberId;
  scheduledOn: LocalDate;
  title: TaskTitle;
  stars: StarAmount;
}>;

export type ClaimedBounty = Readonly<{
  kind: "claimed-bounty";
  claim: BountyClaim;
  revision: ClaimRevision;
  state:
    | { kind: "unfinished" }
    | { kind: "completed"; completion: BountyCompletion }
    | { kind: "released" };
}>;

export type BountyCompletion = Readonly<{
  id: CompletionId;
  claim: ClaimId;
  by: MemberId;
  at: Instant;
  creditedStars: StarAmount;
}>;

export type CreateBountyDraft = Readonly<{
  kind: "bounty";
  type: "chore";
  title: TaskTitle;
  stars: StarAmount;
  recurrence: BountyRecurrence;
}>;

export type TaskCreateDraft =
  | ({ kind: "assigned" } & CreateTaskDraft)
  | CreateBountyDraft;

export type BountyCommand =
  | Readonly<{
      kind: "claim-bounty";
      requestId: BountyCommandId;
      offering: OfferingKey;
      member: MemberId;
      definitionRevision: DefinitionRevision;
    }>
  | Readonly<{
      kind: "claim-bounty";
      requestId: BountyCommandId;
      offering: OfferingKey;
      member: MemberId;
      compatibility: "v4-retry";
    }>
  | Readonly<{
      kind: "complete-bounty";
      requestId: BountyCommandId;
      claim: ClaimId;
      revision: ClaimRevision;
    }>
  | Readonly<{
      kind: "release-bounty";
      requestId: BountyCommandId;
      claim: ClaimId;
      revision: ClaimRevision;
    }>;

export type BountyCommandReceipt =
  | {
      status: "accepted" | "already-applied";
      result: {
        kind: "claimed";
        claim: BountyClaim;
        revision: ClaimRevision;
      };
    }
  | {
      status: "accepted" | "already-applied";
      result: { kind: "completed"; completion: BountyCompletion };
    }
  | {
      status: "accepted" | "already-applied";
      result: {
        kind: "released";
        claim: BountyClaim;
        revision: ClaimRevision;
      };
    }
  | { status: "rejected"; error: string };

export type StarAdjustment = {
  id: string;
  member: MemberId;
  delta: number;
  reason: string | null;
  at: Instant;
};

export type TaskEvent =
  | {
      kind: "completed";
      task: TaskId;
      window: LocalDate;
      by: MemberId;
      at: Instant;
    }
  | {
      kind: "verified";
      task: TaskId;
      window: LocalDate;
      by: MemberId;
      at: Instant;
    }
  | { kind: "claimed"; task: TaskId; window: LocalDate; by: MemberId }
  | { kind: "skipped"; task: TaskId; window: LocalDate; reason: string | null };

export type OccurrenceFields = {
  task: TaskId;
  window: LocalDate;
  title: string;
  type: TaskType;
  lineage: LineageId;
  time: LocalTime | null;
  assignee: MemberId | null;
};

export type Occurrence =
  | (OccurrenceFields & { state: "pending" })
  | (OccurrenceFields & { state: "claimed"; by: MemberId })
  | (OccurrenceFields & { state: "done"; by: MemberId; at: Instant })
  | (OccurrenceFields & { state: "skipped"; reason: string | null })
  | (OccurrenceFields & { state: "expired" });

export type EventReceipt = {
  task: TaskId;
  window: LocalDate;
  kind: TaskEvent["kind"];
} & (
  | { status: "inserted" }
  | { status: "already-present" }
  | { status: "rejected"; error: string }
);

export type MemberProgress = {
  member: MemberId;
  done: number;
  total: number;
};

export type StarBalance = {
  member: MemberId;
  balance: number;
};

export type TasksViewRead = {
  occurrences: Occurrence[];
  progress: MemberProgress[];
  starBalances: StarBalance[];
  definitions: LegacyTaskDefinition[];
  bountyDefinitions: BountyDefinition[];
  availableBounties: AvailableBounty[];
  bountyClaims: ClaimedBounty[];
  today: LocalDate;
  generatedAt: Instant;
};

export type CreateTaskDraft = {
  title: string;
  type: TaskType;
  recurrence: Recurrence;
  assignment: AssignmentPolicy;
  time: LocalTime | null;
  stars: number;
};

export type SaveTaskDraft = CreateTaskDraft & { id: TaskId };

export type DefinitionSavePlan =
  | {
      kind: "in-place";
      title: string;
      type: TaskType;
      time: LocalTime | null;
      stars: number;
    }
  | {
      kind: "replace";
      retiredAt: LocalDate;
      replacement: LegacyTaskDefinition;
    };

export function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

function nonEmptyString(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function parseTaskId(raw: unknown): TaskId | null {
  const value = nonEmptyString(raw);
  return value ? (value as TaskId) : null;
}

export function parseLineageId(raw: unknown): LineageId | null {
  const value = nonEmptyString(raw);
  return value ? (value as LineageId) : null;
}

export function parseLocalTime(raw: unknown): LocalTime | null {
  if (typeof raw !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    return null;
  }
  return raw as LocalTime;
}

export function parseInstant(raw: unknown): Instant | null {
  if (typeof raw !== "string") return null;
  if (Number.isNaN(Date.parse(raw))) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  return raw as Instant;
}

export function nowInstant(): Instant {
  return new Date().toISOString() as Instant;
}

export function newTaskId(): TaskId {
  return crypto.randomUUID() as TaskId;
}

export function newLineageId(): LineageId {
  return crypto.randomUUID() as LineageId;
}

export function newOfferingId(): OfferingId {
  return crypto.randomUUID() as OfferingId;
}

export function newClaimId(): ClaimId {
  return crypto.randomUUID() as ClaimId;
}

export function newCompletionId(): CompletionId {
  return crypto.randomUUID() as CompletionId;
}

function parseBrandedId<B extends string>(
  raw: unknown,
): Brand<string, B> | null {
  const value = nonEmptyString(raw);
  return value ? (value as Brand<string, B>) : null;
}

export function parseOfferingId(raw: unknown): OfferingId | null {
  return parseBrandedId<"OfferingId">(raw);
}

export function parseClaimId(raw: unknown): ClaimId | null {
  return parseBrandedId<"ClaimId">(raw);
}

export function parseCompletionId(raw: unknown): CompletionId | null {
  return parseBrandedId<"CompletionId">(raw);
}

export function parseBountyCommandId(raw: unknown): BountyCommandId | null {
  return parseBrandedId<"BountyCommandId">(raw);
}

export function parseStarAmount(raw: unknown): StarAmount | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? (raw as StarAmount)
    : null;
}

export function parseClaimRevision(raw: unknown): ClaimRevision | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? (raw as ClaimRevision)
    : null;
}

export function parseDefinitionRevision(
  raw: unknown,
): DefinitionRevision | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? (raw as DefinitionRevision)
    : null;
}

export function parseTaskTitle(raw: unknown): TaskTitle | null {
  if (typeof raw !== "string") return null;
  const title = raw.trim();
  return title ? (title as TaskTitle) : null;
}

function parseNonEmpty<T>(
  raw: unknown,
  parseOne: (item: unknown) => T | null,
): NonEmpty<T> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parseOne(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out as NonEmpty<T>;
}

export function parseRecurrence(raw: unknown): Recurrence | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "daily":
      return { kind: "daily" };
    case "once": {
      const date = parseLocalDate(raw.date);
      return date ? { kind: "once", date } : null;
    }
    case "weekly": {
      const days = parseNonEmpty(raw.days, parseWeekday);
      return days ? { kind: "weekly", days } : null;
    }
    case "monthly": {
      const day = parseDayOfMonth(raw.day);
      return day ? { kind: "monthly", day } : null;
    }
    default:
      return null;
  }
}

export function parseAssignment(raw: unknown): AssignmentPolicy | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "fixed": {
      const member = nonEmptyString(raw.member);
      return member ? { kind: "fixed", member } : null;
    }
    case "rotation": {
      const order = parseNonEmpty(raw.order, nonEmptyString);
      return order ? { kind: "rotation", order } : null;
    }
    case "open":
      return { kind: "open" };
    default:
      return null;
  }
}

export function parseTaskType(raw: unknown): TaskType | null {
  return raw === "chore" || raw === "routine" ? raw : null;
}

export function parseTaskEvent(raw: unknown): TaskEvent | null {
  if (!isRecord(raw)) return null;
  const task = parseTaskId(raw.task);
  const window = parseLocalDate(raw.window);
  if (!task || !window) return null;
  switch (raw.kind) {
    case "completed":
    case "verified": {
      const by = nonEmptyString(raw.by);
      const at = parseInstant(raw.at);
      if (!by || !at) return null;
      return { kind: raw.kind, task, window, by, at };
    }
    case "claimed": {
      const by = nonEmptyString(raw.by);
      if (!by) return null;
      return { kind: "claimed", task, window, by };
    }
    case "skipped": {
      if (
        raw.reason !== undefined &&
        raw.reason !== null &&
        typeof raw.reason !== "string"
      ) {
        return null;
      }
      const reason =
        typeof raw.reason === "string" ? raw.reason.trim() || null : null;
      return {
        kind: "skipped",
        task,
        window,
        reason,
      };
    }
    default:
      return null;
  }
}

export function parseEventBatch(raw: unknown): TaskEvent[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.events)) return null;
  const events: TaskEvent[] = [];
  for (const item of raw.events) {
    const event = parseTaskEvent(item);
    if (!event) return null;
    events.push(event);
  }
  return events;
}

const CREATE_KEYS = new Set([
  "title",
  "type",
  "recurrence",
  "assignment",
  "time",
  "stars",
]);

export function parseCreateTaskDraft(raw: unknown): CreateTaskDraft | null {
  if (!isRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!CREATE_KEYS.has(key)) return null;
  }
  if (typeof raw.title !== "string") return null;
  const title = raw.title.trim();
  const type = parseTaskType(raw.type);
  const recurrence = parseRecurrence(raw.recurrence);
  const assignment = parseAssignment(raw.assignment);
  if (!title || !type || !recurrence || !assignment) return null;
  const stars = parseStarAmount(raw.stars === undefined ? 0 : raw.stars);
  if (stars === null) return null;
  let time: LocalTime | null = null;
  if (raw.time !== undefined && raw.time !== null && raw.time !== "") {
    time = parseLocalTime(raw.time);
    if (!time) return null;
  }
  return { title, type, recurrence, assignment, time, stars };
}

const BOUNTY_CREATE_KEYS = new Set([
  "kind",
  "type",
  "title",
  "stars",
  "recurrence",
]);

export function parseCreateBountyDraft(raw: unknown): CreateBountyDraft | null {
  if (!isRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!BOUNTY_CREATE_KEYS.has(key)) return null;
  }
  if (
    raw.kind !== "bounty" ||
    (raw.type !== undefined && raw.type !== "chore")
  ) {
    return null;
  }
  const title = parseTaskTitle(raw.title);
  const recurrence = parseBountyRecurrence(raw.recurrence);
  if (!title || !recurrence) return null;
  const stars = parseStarAmount(raw.stars === undefined ? 0 : raw.stars);
  if (stars === null) return null;
  return {
    kind: "bounty",
    type: "chore",
    title,
    stars,
    recurrence,
  };
}

export function parseTaskCreateDraft(raw: unknown): TaskCreateDraft | null {
  if (isRecord(raw) && raw.kind === "bounty")
    return parseCreateBountyDraft(raw);
  const assigned = parseCreateTaskDraft(raw);
  if (
    !assigned ||
    (assigned.type === "routine" && assigned.assignment.kind === "open")
  ) {
    return null;
  }
  return { kind: "assigned", ...assigned };
}

function hasOnlyKnownKeys(
  raw: Record<string, unknown>,
  keys: Set<string>,
): boolean {
  return Object.keys(raw).every((key) => keys.has(key));
}

function parseOfferingKey(raw: unknown): OfferingKey | null {
  if (!isRecord(raw)) return null;
  const definition = parseTaskId(raw.definition);
  if (!definition) return null;
  if (raw.kind === "once") {
    return hasOnlyKnownKeys(raw, new Set(["kind", "definition"]))
      ? { kind: "once", definition }
      : null;
  }
  const intervalStart = parseLocalDate(raw.intervalStart);
  return raw.kind === "recurring" &&
    intervalStart &&
    hasOnlyKnownKeys(raw, new Set(["kind", "definition", "intervalStart"]))
    ? { kind: "recurring", definition, intervalStart }
    : null;
}

export function parseBountyCommand(raw: unknown): BountyCommand | null {
  if (!isRecord(raw)) return null;
  const requestId = parseBountyCommandId(raw.requestId);
  if (!requestId) return null;
  if (raw.kind === "claim-bounty") {
    if (
      !hasOnlyKnownKeys(
        raw,
        new Set([
          "kind",
          "requestId",
          "offering",
          "member",
          "definitionRevision",
        ]),
      )
    ) {
      return null;
    }
    const offering = parseOfferingKey(raw.offering);
    const member = nonEmptyString(raw.member);
    const definitionRevision =
      raw.definitionRevision === undefined
        ? undefined
        : parseDefinitionRevision(raw.definitionRevision);
    return offering && member && definitionRevision !== null
      ? {
          kind: "claim-bounty",
          requestId,
          offering,
          member,
          ...(definitionRevision === undefined
            ? { compatibility: "v4-retry" as const }
            : { definitionRevision }),
        }
      : null;
  }
  if (raw.kind === "complete-bounty" || raw.kind === "release-bounty") {
    if (
      !hasOnlyKnownKeys(
        raw,
        new Set(["kind", "requestId", "claim", "revision"]),
      )
    ) {
      return null;
    }
    const claim = parseClaimId(raw.claim);
    const revision = parseClaimRevision(raw.revision);
    return claim && revision !== null
      ? { kind: raw.kind, requestId, claim, revision }
      : null;
  }
  return null;
}

function parseBountyClaim(raw: unknown): BountyClaim | null {
  if (
    !isRecord(raw) ||
    !hasOnlyKnownKeys(
      raw,
      new Set(["id", "offering", "member", "scheduledOn", "title", "stars"]),
    )
  ) {
    return null;
  }
  const id = parseClaimId(raw.id);
  const offering = parseOfferingKey(raw.offering);
  const member = nonEmptyString(raw.member);
  const scheduledOn = parseLocalDate(raw.scheduledOn);
  const title = parseTaskTitle(raw.title);
  const stars = parseStarAmount(raw.stars);
  if (!id || !offering || !member || !scheduledOn || !title || stars === null) {
    return null;
  }
  return { id, offering, member, scheduledOn, title, stars };
}

function parseBountyCompletion(raw: unknown): BountyCompletion | null {
  if (
    !isRecord(raw) ||
    !hasOnlyKnownKeys(
      raw,
      new Set(["id", "claim", "by", "at", "creditedStars"]),
    )
  ) {
    return null;
  }
  const id = parseCompletionId(raw.id);
  const claim = parseClaimId(raw.claim);
  const by = nonEmptyString(raw.by);
  const at = parseInstant(raw.at);
  const creditedStars = parseStarAmount(raw.creditedStars);
  if (!id || !claim || !by || !at || creditedStars === null) return null;
  return { id, claim, by, at, creditedStars };
}

export function parseBountyCommandReceipt(
  raw: unknown,
): BountyCommandReceipt | null {
  if (!isRecord(raw)) return null;
  if (raw.status === "rejected") {
    if (
      !hasOnlyKnownKeys(raw, new Set(["status", "error"])) ||
      typeof raw.error !== "string" ||
      raw.error.length === 0
    ) {
      return null;
    }
    return { status: "rejected", error: raw.error };
  }
  if (
    (raw.status !== "accepted" && raw.status !== "already-applied") ||
    !hasOnlyKnownKeys(raw, new Set(["status", "result"])) ||
    !isRecord(raw.result)
  ) {
    return null;
  }
  if (
    raw.result.kind === "claimed" &&
    hasOnlyKnownKeys(raw.result, new Set(["kind", "claim", "revision"]))
  ) {
    const legacyClaim = isRecord(raw.result.claim) ? raw.result.claim : null;
    const revision = parseClaimRevision(
      raw.result.revision ?? legacyClaim?.revision,
    );
    const claim = parseBountyClaim(
      legacyClaim
        ? Object.fromEntries(
            Object.entries(legacyClaim).filter(([key]) => key !== "revision"),
          )
        : raw.result.claim,
    );
    return claim && revision !== null
      ? { status: raw.status, result: { kind: "claimed", claim, revision } }
      : null;
  }
  if (
    raw.result.kind === "completed" &&
    hasOnlyKnownKeys(raw.result, new Set(["kind", "completion"]))
  ) {
    const completion = parseBountyCompletion(raw.result.completion);
    return completion
      ? { status: raw.status, result: { kind: "completed", completion } }
      : null;
  }
  if (
    raw.result.kind === "released" &&
    hasOnlyKnownKeys(raw.result, new Set(["kind", "claim", "revision"]))
  ) {
    const claim = parseBountyClaim(raw.result.claim);
    const revision = parseClaimRevision(raw.result.revision);
    return claim && revision !== null
      ? { status: raw.status, result: { kind: "released", claim, revision } }
      : null;
  }
  return null;
}

export function parseBountyDefinition(raw: unknown): BountyDefinition | null {
  if (
    !isRecord(raw) ||
    !hasOnlyKnownKeys(
      raw,
      new Set([
        "kind",
        "id",
        "lineage",
        "type",
        "title",
        "stars",
        "recurrence",
        "offerFrom",
        "revision",
        "retiredAt",
      ]),
    ) ||
    raw.kind !== "bounty" ||
    raw.type !== "chore"
  ) {
    return null;
  }
  const id = parseTaskId(raw.id);
  const lineage = parseLineageId(raw.lineage);
  const title = parseTaskTitle(raw.title);
  const stars = parseStarAmount(raw.stars);
  const revision = parseDefinitionRevision(raw.revision);
  const recurrence = parseBountyRecurrence(raw.recurrence);
  const offerFrom =
    raw.offerFrom === undefined || raw.offerFrom === null
      ? null
      : parseLocalDate(raw.offerFrom);
  const retiredAt =
    raw.retiredAt === null ? null : parseLocalDate(raw.retiredAt);
  return id &&
    lineage &&
    title &&
    stars !== null &&
    revision !== null &&
    recurrence &&
    (raw.offerFrom === undefined || raw.offerFrom === null || offerFrom) &&
    (raw.retiredAt === null || retiredAt)
    ? {
        kind: "bounty",
        id,
        lineage,
        type: "chore",
        title,
        stars,
        recurrence,
        offerFrom,
        revision,
        retiredAt,
      }
    : null;
}

export function createDefinition(draft: CreateTaskDraft): LegacyTaskDefinition {
  return {
    id: newTaskId(),
    lineage: newLineageId(),
    title: draft.title,
    type: draft.type,
    recurrence: draft.recurrence,
    assignment: draft.assignment,
    time: draft.time,
    stars: draft.stars,
    retiredAt: null,
  };
}

export function createBountyDefinition(
  draft: CreateBountyDraft,
): BountyDefinition {
  return {
    kind: "bounty",
    id: newTaskId(),
    lineage: newLineageId(),
    type: "chore",
    title: draft.title,
    stars: draft.stars,
    recurrence: draft.recurrence,
    offerFrom: null,
    revision: 0 as DefinitionRevision,
    retiredAt: null,
  };
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((item) => right.includes(item)) &&
    right.every((item) => left.includes(item))
  );
}

export function recurrenceEquals(left: Recurrence, right: Recurrence): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "daily":
      return true;
    case "once":
      return right.kind === "once" && left.date === right.date;
    case "weekly":
      return right.kind === "weekly" && sameItems(left.days, right.days);
    case "monthly":
      return right.kind === "monthly" && left.day === right.day;
    default: {
      const _exhaustive: never = left;
      return _exhaustive;
    }
  }
}

export function assignmentEquals(
  left: AssignmentPolicy,
  right: AssignmentPolicy,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "open":
      return true;
    case "fixed":
      return right.kind === "fixed" && left.member === right.member;
    case "rotation":
      return (
        right.kind === "rotation" &&
        left.order.length === right.order.length &&
        left.order.every((id, index) => id === right.order[index])
      );
    default: {
      const _exhaustive: never = left;
      return _exhaustive;
    }
  }
}

export function rotateRotationOrder<T>(
  order: NonEmpty<T>,
  completedCount: number,
): NonEmpty<T> {
  const shift = completedCount % order.length;
  if (shift === 0) return order;
  return [...order.slice(shift), ...order.slice(0, shift)] as NonEmpty<T>;
}

function replacementRotation(
  current: NonEmpty<MemberId>,
  submitted: NonEmpty<MemberId>,
  completedCount: number,
): NonEmpty<MemberId> {
  const preRotated = rotateRotationOrder(current, completedCount);
  if (sameItems(current, submitted)) return preRotated;
  const remaining = preRotated.filter((id) => submitted.includes(id));
  const added = submitted.filter((id) => !current.includes(id));
  const [first, ...rest] = [...remaining, ...added];
  return first === undefined ? submitted : [first, ...rest];
}

export function planDefinitionSave(input: {
  current: LegacyTaskDefinition;
  draft: CreateTaskDraft;
  today: LocalDate;
  nextId: TaskId;
  completedCount: number;
}): DefinitionSavePlan {
  const { current, draft, today, nextId, completedCount } = input;
  if (
    recurrenceEquals(current.recurrence, draft.recurrence) &&
    assignmentEquals(current.assignment, draft.assignment)
  ) {
    return {
      kind: "in-place",
      title: draft.title,
      type: draft.type,
      time: draft.time,
      stars: draft.stars,
    };
  }
  const assignment =
    draft.assignment.kind === "rotation" &&
    current.assignment.kind === "rotation"
      ? {
          kind: "rotation" as const,
          order: replacementRotation(
            current.assignment.order,
            draft.assignment.order,
            completedCount,
          ),
        }
      : draft.assignment;
  return {
    kind: "replace",
    retiredAt: today,
    replacement: {
      id: nextId,
      lineage: current.lineage,
      title: draft.title,
      type: draft.type,
      recurrence: draft.recurrence,
      assignment,
      time: draft.time,
      stars: draft.stars,
      retiredAt: null,
    },
  };
}

const SAVE_KEYS = new Set([...CREATE_KEYS, "id"]);

export function parseSaveTaskDraft(raw: unknown): SaveTaskDraft | null {
  if (!isRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!SAVE_KEYS.has(key)) return null;
  }
  const id = parseTaskId(raw.id);
  if (!id) return null;
  const draft = parseCreateTaskDraft(
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "id")),
  );
  return draft ? { id, ...draft } : null;
}
