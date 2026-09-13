import {
  type CreateTaskDraft,
  type Instant,
  isRecord,
  type LegacyTaskDefinition,
  type LocalDate,
  parseCreateTaskDraft,
  parseLocalDate,
  parseTaskId,
  type StarAdjustment,
  type StarBalance,
  type TaskEvent,
  type TaskId,
} from "./types";

export type TaskAdminRead = {
  definitions: LegacyTaskDefinition[];
  events: TaskEvent[];
  originalEvents: TaskEvent[];
  corrections: CompletionCorrection[];
  adjustments: StarAdjustment[];
  balances: StarBalance[];
  today: LocalDate;
};

export type CompletionCorrection = {
  id: string;
  task: TaskId;
  window: LocalDate;
  by: string | null; // null retracts the completion; an ID restores/reassigns it.
  reason: string;
  at: Instant;
  previous: string | null;
};

export type TaskAdminCommand =
  | { kind: "create"; id: string; draft: CreateTaskDraft }
  | { kind: "edit"; task: TaskId; draft: CreateTaskDraft }
  | { kind: "retire"; task: TaskId }
  | { kind: "correct"; correction: Omit<CompletionCorrection, "at"> }
  | {
      kind: "adjust-stars";
      id: string;
      member: string;
      delta: number;
      reason: string;
    };

export function parseTaskAdminCommand(raw: unknown): TaskAdminCommand | null {
  if (!isRecord(raw)) return null;
  const id =
    typeof raw.id === "string" && /^[a-f0-9-]{32,36}$/.test(raw.id)
      ? raw.id
      : null;
  if (raw.kind === "create") {
    const draft = parseCreateTaskDraft(raw.draft);
    return id && draft ? { kind: "create", id, draft } : null;
  }
  if (raw.kind === "adjust-stars") {
    return id &&
      typeof raw.member === "string" &&
      raw.member &&
      typeof raw.delta === "number" &&
      Number.isSafeInteger(raw.delta) &&
      raw.delta !== 0 &&
      typeof raw.reason === "string" &&
      raw.reason.trim()
      ? {
          kind: "adjust-stars",
          id,
          member: raw.member,
          delta: raw.delta,
          reason: raw.reason.trim(),
        }
      : null;
  }
  const task = parseTaskId(raw.task);
  if (!task) return null;
  if (raw.kind === "retire") return { kind: "retire", task };
  if (raw.kind === "edit") {
    const draft = parseCreateTaskDraft(raw.draft);
    return draft ? { kind: "edit", task, draft } : null;
  }
  const window = parseLocalDate(raw.window);
  if (
    raw.kind === "correct" &&
    id &&
    window &&
    (raw.by === null || (typeof raw.by === "string" && raw.by.length > 0)) &&
    (raw.previous === null || typeof raw.previous === "string") &&
    typeof raw.reason === "string" &&
    raw.reason.trim()
  ) {
    return {
      kind: "correct",
      correction: {
        id,
        task,
        window,
        by: raw.by,
        previous: raw.previous,
        reason: raw.reason.trim(),
      },
    };
  }
  return null;
}
