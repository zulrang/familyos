import {
  addLocalDays,
  type LocalDate,
  type Occurrence,
  type TaskDefinition,
  type TaskEvent,
  type TaskId,
} from "./types";

function eventMap(events: readonly TaskEvent[]): Map<string, TaskEvent> {
  const map = new Map<string, TaskEvent>();
  for (const event of events) {
    map.set(`${event.task}:${event.window}:${event.kind}`, event);
  }
  return map;
}

function foldOccurrence(
  definition: TaskDefinition,
  window: LocalDate,
  today: LocalDate,
  events: Map<string, TaskEvent>,
  completedCount: number,
): Occurrence {
  const pendingAssignee =
    definition.assignment.kind === "fixed"
      ? definition.assignment.member
      : definition.assignment.kind === "rotation"
        ? definition.assignment.order[
            completedCount % definition.assignment.order.length
          ]
        : null;
  const base = {
    task: definition.id,
    window,
    title: definition.title,
    type: definition.type,
    lineage: definition.lineage,
    time: definition.time,
    assignee: pendingAssignee,
  };
  const completed = events.get(`${definition.id}:${window}:completed`);
  if (completed?.kind === "completed") {
    return {
      ...base,
      state: "done",
      by: completed.by,
      at: completed.at,
      assignee:
        definition.assignment.kind === "rotation"
          ? completed.by
          : pendingAssignee,
    };
  }
  const skipped = events.get(`${definition.id}:${window}:skipped`);
  if (skipped?.kind === "skipped") {
    return { ...base, state: "skipped", reason: skipped.reason };
  }
  const claimed = events.get(`${definition.id}:${window}:claimed`);
  if (claimed?.kind === "claimed") {
    return {
      ...base,
      state: "claimed",
      by: claimed.by,
    };
  }
  if (window === today) {
    return { ...base, state: "pending" };
  }
  return { ...base, state: "expired" };
}

function compareOccurrences(
  a: Occurrence,
  b: Occurrence,
  order: ReadonlyMap<TaskId, number>,
): number {
  if (a.time && b.time) {
    if (a.time < b.time) return -1;
    if (a.time > b.time) return 1;
  } else if (a.time) {
    return -1;
  } else if (b.time) {
    return 1;
  }
  return (order.get(a.task) ?? 0) - (order.get(b.task) ?? 0);
}

export function view(
  definitions: readonly TaskDefinition[],
  events: readonly TaskEvent[],
  today: LocalDate,
): Occurrence[] {
  const order = new Map<TaskId, number>();
  definitions.forEach((definition, index) => {
    order.set(definition.id, index);
  });
  const byKey = eventMap(events);
  const completedCounts = new Map<TaskId, number>();
  for (const event of events) {
    if (event.kind !== "completed") continue;
    completedCounts.set(event.task, (completedCounts.get(event.task) ?? 0) + 1);
  }
  const yesterday = addLocalDays(today, -1);
  const out: Occurrence[] = [];
  for (const definition of definitions) {
    if (definition.retiredAt !== null) continue;
    if (
      definition.recurrence.kind !== "daily" ||
      definition.assignment.kind === "open"
    ) {
      continue;
    }
    const completedCount = completedCounts.get(definition.id) ?? 0;
    void foldOccurrence(definition, yesterday, today, byKey, completedCount);
    const current = foldOccurrence(
      definition,
      today,
      today,
      byKey,
      completedCount,
    );
    if (current.state !== "expired") out.push(current);
  }
  out.sort((a, b) => compareOccurrences(a, b, order));
  return out;
}
