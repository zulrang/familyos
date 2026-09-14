import type { HouseholdMember } from "@/members/members";
import type { CompletionCorrection } from "./admin-types";
import { releaseBountiesForRetiredMembers } from "./bounty-store";
import { migrateLegacyOpenWork } from "./legacy-bounty-store-migration";
import {
  insertDefinition,
  loadCompletionCorrections,
  loadDefinitions,
  loadEffectiveEvents,
  loadEvents,
  loadStoredStarBalances,
  tasksDatabase,
  taskTransaction,
} from "./store";
import {
  type AssignmentPolicy,
  allowsAssignedDraft,
  assignmentEquals,
  type CreateTaskDraft,
  createDefinition,
  type LegacyTaskDefinition,
  type LocalDate,
  type NonEmpty,
  newTaskId,
  recurrenceEquals,
  type StarAdjustment,
  type TaskId,
} from "./types";

export class TaskAdminError extends Error {}

function requireActiveTask(task: TaskId) {
  const definition = loadDefinitions().find((row) => row.id === task);
  if (!definition || definition.retiredAt !== null)
    throw new TaskAdminError(
      "This task is retired or no longer exists. Refresh to see the current version.",
    );
  return definition;
}

function retirement(task: TaskId, today: LocalDate) {
  tasksDatabase()
    .prepare(
      "UPDATE definitions SET retired_at = ? WHERE id = ? AND retired_at IS NULL",
    )
    .run(today, task);
}

/** Preserve the next surviving person's turn when a rotation is replaced. */
export function preserveRotationTurn(
  previous: AssignmentPolicy,
  next: AssignmentPolicy,
  completed: number,
): AssignmentPolicy {
  if (previous.kind !== "rotation" || next.kind !== "rotation") return next;
  const offset = completed % previous.order.length;
  const upcoming = [
    ...previous.order.slice(offset),
    ...previous.order.slice(0, offset),
  ];
  const first = upcoming.find((member) => next.order.includes(member));
  const start = first ? next.order.indexOf(first) : 0;
  return {
    kind: "rotation",
    order: [
      ...next.order.slice(start),
      ...next.order.slice(0, start),
    ] as NonEmpty<string>,
  };
}

function saveTask(task: TaskId, draft: CreateTaskDraft, today: LocalDate) {
  const previous = requireActiveTask(task);
  if (!allowsAssignedDraft(previous, draft)) {
    throw new TaskAdminError(
      "New open Routines are not supported. Assign this Routine to a member or rotation.",
    );
  }
  if (
    assignmentEquals(previous.assignment, draft.assignment) &&
    recurrenceEquals(previous.recurrence, draft.recurrence)
  ) {
    tasksDatabase()
      .prepare(
        "UPDATE definitions SET title = ?, type = ?, time = ?, stars = ? WHERE id = ?",
      )
      .run(draft.title, draft.type, draft.time, draft.stars, task);
    return { ...previous, ...draft };
  }
  const completed = loadEffectiveEvents().filter(
    (event) => event.task === task && event.kind === "completed",
  ).length;
  const replacement: LegacyTaskDefinition = {
    ...draft,
    id: newTaskId(),
    lineage: previous.lineage,
    retiredAt: null,
    assignment: preserveRotationTurn(
      previous.assignment,
      draft.assignment,
      completed,
    ),
  };
  retirement(task, today);
  insertDefinition(replacement);
  return replacement;
}

export function editAdminTask(
  task: TaskId,
  draft: CreateTaskDraft,
  today: LocalDate,
) {
  return taskTransaction(() => saveTask(task, draft, today));
}

export function createAdminTask(id: string, draft: CreateTaskDraft) {
  return taskTransaction(() => {
    const existing = loadDefinitions().find((row) => row.id === id);
    if (existing) return existing;
    const definition = { ...createDefinition(draft), id: id as TaskId };
    insertDefinition(definition);
    return definition;
  });
}

export function retireAdminTask(task: TaskId, today: LocalDate) {
  return taskTransaction(() => retirement(task, today));
}

/** Idempotent recovery: a durable roster retirement is reconciled before task reads/writes. */
export function reconcileRetiredMembers(
  members: HouseholdMember[],
  today: LocalDate,
) {
  migrateLegacyOpenWork({ db: tasksDatabase(), today, members });
  const retired = new Set(
    members
      .filter((member) => member.status === "retired")
      .map((member) => member.id),
  );
  if (retired.size === 0) return;
  taskTransaction(() => {
    for (const definition of loadDefinitions()) {
      if (definition.retiredAt !== null) continue;
      const assignment = definition.assignment;
      if (assignment.kind === "fixed" && retired.has(assignment.member))
        retirement(definition.id, today);
      if (
        assignment.kind !== "rotation" ||
        !assignment.order.some((id) => retired.has(id))
      )
        continue;
      const order = assignment.order.filter((id) => !retired.has(id));
      if (!order.length) retirement(definition.id, today);
      else
        saveTask(
          definition.id,
          {
            title: definition.title,
            type: definition.type,
            recurrence: definition.recurrence,
            assignment: { kind: "rotation", order: order as NonEmpty<string> },
            time: definition.time,
            stars: definition.stars,
          },
          today,
        );
    }
    releaseBountiesForRetiredMembers(tasksDatabase(), retired);
  });
}

function changeBalance(member: string, delta: number) {
  const before =
    loadStoredStarBalances().find((row) => row.member === member)?.balance ?? 0;
  const balance = before + delta;
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new TaskAdminError(
      "This correction would put a star balance below zero or above the supported limit.",
    );
  tasksDatabase()
    .prepare(
      "INSERT INTO star_balances (member, balance) VALUES (?, ?) ON CONFLICT(member) DO UPDATE SET balance = excluded.balance",
    )
    .run(member, balance);
}

export function adjustAdminStars(adjustment: StarAdjustment) {
  taskTransaction(() => {
    const db = tasksDatabase();
    const existing = db
      .prepare("SELECT * FROM star_adjustments WHERE id = ?")
      .get(adjustment.id);
    if (existing) {
      if (
        existing.member !== adjustment.member ||
        existing.delta !== adjustment.delta ||
        existing.reason !== adjustment.reason
      )
        throw new TaskAdminError(
          "That request has already been used for a different adjustment.",
        );
      return;
    }
    const balance =
      (loadStoredStarBalances().find((row) => row.member === adjustment.member)
        ?.balance ?? 0) + adjustment.delta;
    if (!Number.isSafeInteger(balance) || balance < 0)
      throw new TaskAdminError(
        "The adjustment would put this balance below zero or above the supported limit.",
      );
    db.prepare(
      "INSERT INTO star_adjustments (id, member, delta, reason, at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      adjustment.id,
      adjustment.member,
      adjustment.delta,
      adjustment.reason,
      adjustment.at,
    );
  });
}

export function correctAdminCompletion(correction: CompletionCorrection) {
  taskTransaction(() => {
    const db = tasksDatabase();
    const history = loadCompletionCorrections();
    const duplicate = history.find((row) => row.id === correction.id);
    if (duplicate) {
      if (
        duplicate.task !== correction.task ||
        duplicate.window !== correction.window ||
        duplicate.by !== correction.by ||
        duplicate.reason !== correction.reason ||
        duplicate.previous !== correction.previous
      )
        throw new TaskAdminError(
          "That request has already been used for a different correction.",
        );
      return;
    }
    const original = loadEvents().find(
      (event) =>
        event.kind === "completed" &&
        event.task === correction.task &&
        event.window === correction.window,
    );
    if (!original || original.kind !== "completed")
      throw new TaskAdminError("Completion not found.");
    const previous = history
      .filter(
        (row) =>
          row.task === correction.task && row.window === correction.window,
      )
      .at(-1);
    if ((previous?.id ?? null) !== correction.previous)
      throw new TaskAdminError(
        "This completion changed on another phone. Refresh before correcting it.",
      );
    const previousMember = previous ? previous.by : original.by;
    if (previousMember === correction.by)
      throw new TaskAdminError(
        "Choose a different outcome for this completion.",
      );
    // Legacy completions before ADR 0007 have no stored credit to reverse.
    const stars = Number(
      db
        .prepare(
          "SELECT stars FROM completion_credits WHERE task = ? AND window = ?",
        )
        .get(correction.task, correction.window)?.stars ?? 0,
    );
    if (previousMember) changeBalance(previousMember, -stars);
    if (correction.by) changeBalance(correction.by, stars);
    db.prepare(
      "INSERT INTO completion_corrections (id, task, window, by, reason, at, previous) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      correction.id,
      correction.task,
      correction.window,
      correction.by,
      correction.reason,
      correction.at,
      correction.previous,
    );
  });
}
