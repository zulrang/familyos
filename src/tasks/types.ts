import type { MemberId } from "@/members/members";

type Brand<T, B extends string> = T & { readonly __brand: B };

export type TaskId = Brand<string, "TaskId">;
export type LineageId = Brand<string, "LineageId">;
export type LocalDate = Brand<string, "LocalDate">;
export type LocalTime = Brand<string, "LocalTime">;
export type Instant = Brand<string, "Instant">;
export type DayOfMonth = Brand<number, "DayOfMonth">;

export type NonEmpty<T> = [T, ...T[]];

export type TaskType = "chore" | "routine";

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export type Recurrence =
  | { kind: "once"; date: LocalDate }
  | { kind: "daily" }
  | { kind: "weekly"; days: NonEmpty<Weekday> }
  | { kind: "monthly"; day: DayOfMonth };

export type AssignmentPolicy =
  | { kind: "fixed"; member: MemberId }
  | { kind: "rotation"; order: NonEmpty<MemberId> }
  | { kind: "open" };

export type TaskDefinition = {
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
  today: LocalDate;
  generatedAt: Instant;
};

export type CreateTaskDraft = {
  title: string;
  type: TaskType;
  member: MemberId;
  time: LocalTime | null;
  stars: number;
};

const WEEKDAYS = new Set<string>([
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
]);

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

export function parseLocalDate(raw: unknown): LocalDate | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return raw as LocalDate;
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

function parseWeekday(raw: unknown): Weekday | null {
  return typeof raw === "string" && WEEKDAYS.has(raw) ? (raw as Weekday) : null;
}

function parseDayOfMonth(raw: unknown): DayOfMonth | null {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 28
  ) {
    return null;
  }
  return raw as DayOfMonth;
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
      return {
        kind: "skipped",
        task,
        window,
        reason: typeof raw.reason === "string" ? raw.reason : null,
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

const CREATE_KEYS = new Set(["title", "type", "member", "time", "stars"]);

export function parseCreateTaskDraft(raw: unknown): CreateTaskDraft | null {
  if (!isRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!CREATE_KEYS.has(key)) return null;
  }
  if (typeof raw.title !== "string") return null;
  const title = raw.title.trim();
  const type = parseTaskType(raw.type);
  const member = nonEmptyString(raw.member);
  if (!title || !type || !member) return null;
  const stars = raw.stars === undefined ? 0 : raw.stars;
  if (typeof stars !== "number" || !Number.isSafeInteger(stars) || stars < 0) {
    return null;
  }
  let time: LocalTime | null = null;
  if (raw.time !== undefined && raw.time !== null && raw.time !== "") {
    time = parseLocalTime(raw.time);
    if (!time) return null;
  }
  return { title, type, member, time, stars };
}

export function dailyFixedDefinition(draft: CreateTaskDraft): TaskDefinition {
  return {
    id: newTaskId(),
    lineage: newLineageId(),
    title: draft.title,
    type: draft.type,
    recurrence: { kind: "daily" },
    assignment: { kind: "fixed", member: draft.member },
    time: draft.time,
    stars: draft.stars,
    retiredAt: null,
  };
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const next = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
  return next as LocalDate;
}
