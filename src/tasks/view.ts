import {
  addLocalDays,
  type LocalDate,
  type Occurrence,
  type Recurrence,
  type StarAdjustment,
  type StarBalance,
  type TaskDefinition,
  type TaskEvent,
  type TaskId,
  type Weekday,
} from "./types";

type WindowStarts = {
  current: LocalDate | null;
  previous: LocalDate | null;
};

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function eventMap(events: readonly TaskEvent[]): Map<string, TaskEvent> {
  const map = new Map<string, TaskEvent>();
  for (const event of events) {
    const key = `${event.task}:${event.window}:${event.kind}`;
    if (!map.has(key)) map.set(key, event);
  }
  return map;
}

function foldOccurrence(
  definition: TaskDefinition,
  window: LocalDate,
  fallbackState: "pending" | "expired",
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
        definition.assignment.kind === "fixed" ? pendingAssignee : completed.by,
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
      assignee:
        definition.assignment.kind === "open" ? claimed.by : base.assignee,
      state: "claimed",
      by: claimed.by,
    };
  }
  return { ...base, state: fallbackState };
}

function weekday(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function monthlyDate(
  date: LocalDate,
  monthOffset: number,
  day: number,
): LocalDate {
  const [year, month] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + monthOffset, day));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}` as LocalDate;
}

function weeklyWindowStarts(
  days: readonly Weekday[],
  today: LocalDate,
): WindowStarts {
  const selected = [...new Set(days.map((day) => WEEKDAY_INDEX[day]))];
  const todayIndex = weekday(today);
  const currentOffset = Math.min(
    ...selected.map((day) => (todayIndex - day + 7) % 7),
  );
  const current = addLocalDays(today, -currentOffset);
  const currentIndex = weekday(current);
  const previousOffset = Math.min(
    ...selected.map((day) => (currentIndex - day + 7) % 7 || 7),
  );
  return {
    current,
    previous: addLocalDays(current, -previousOffset),
  };
}

function windowStarts(recurrence: Recurrence, today: LocalDate): WindowStarts {
  switch (recurrence.kind) {
    case "once":
      return {
        current: today === recurrence.date ? recurrence.date : null,
        previous: today > recurrence.date ? recurrence.date : null,
      };
    case "daily": {
      return {
        current: today,
        previous: addLocalDays(today, -1),
      };
    }
    case "weekly":
      return weeklyWindowStarts(recurrence.days, today);
    case "monthly": {
      const todayDay = Number(today.slice(8, 10));
      const current = monthlyDate(
        today,
        recurrence.day <= todayDay ? 0 : -1,
        recurrence.day,
      );
      return {
        current,
        previous: monthlyDate(current, -1, recurrence.day),
      };
    }
    default: {
      const _exhaustive: never = recurrence;
      return _exhaustive;
    }
  }
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
  const out: Occurrence[] = [];
  for (const definition of definitions) {
    if (definition.retiredAt !== null) continue;
    const windows = windowStarts(definition.recurrence, today);
    const completedCount = completedCounts.get(definition.id) ?? 0;
    if (windows.previous !== null) {
      void foldOccurrence(
        definition,
        windows.previous,
        "expired",
        byKey,
        completedCount,
      );
    }
    if (windows.current !== null) {
      out.push(
        foldOccurrence(
          definition,
          windows.current,
          "pending",
          byKey,
          completedCount,
        ),
      );
    }
  }
  out.sort((a, b) => compareOccurrences(a, b, order));
  return out;
}

export function starBalances(
  definitions: readonly TaskDefinition[],
  events: readonly TaskEvent[],
  adjustments: readonly StarAdjustment[],
): StarBalance[] {
  const starsByTask = new Map(
    definitions.map((definition) => [definition.id, definition.stars]),
  );
  const balances = new Map<StarBalance["member"], number>();
  for (const event of events) {
    if (event.kind !== "completed") continue;
    const stars = starsByTask.get(event.task);
    if (stars === undefined) continue;
    const balance = (balances.get(event.by) ?? 0) + stars;
    if (!Number.isSafeInteger(balance)) {
      throw new RangeError("star balance exceeds safe integer range");
    }
    balances.set(event.by, balance);
  }
  for (const adjustment of adjustments) {
    const balance = (balances.get(adjustment.member) ?? 0) + adjustment.delta;
    if (!Number.isSafeInteger(balance)) {
      throw new RangeError("star balance exceeds safe integer range");
    }
    balances.set(adjustment.member, balance);
  }
  return [...balances]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([member, balance]) => ({ member, balance }));
}
