import {
  addLocalDays,
  type DayOfMonth,
  isRecord,
  type LocalDate,
  parseDayOfMonth,
  parseLocalDate,
  parseWeekday,
  type Weekday,
} from "./types";

declare const distinctWeekdaysBrand: unique symbol;

export type NonEmptyDistinctWeekdays = readonly [Weekday, ...Weekday[]] & {
  readonly [distinctWeekdaysBrand]: true;
};

export type CalendarCadence =
  | Readonly<{ kind: "daily" }>
  | Readonly<{ kind: "weekly"; days: NonEmptyDistinctWeekdays }>
  | Readonly<{ kind: "monthly"; day: DayOfMonth }>;

export type RecurringBountySchedule = Readonly<{
  kind: "recurring";
  startsOn: LocalDate;
  cadence: CalendarCadence;
}>;

export type BountyInterval = Readonly<{
  start: LocalDate;
  next: LocalDate;
}>;

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function hasExactlyKeys(
  raw: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(raw);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

export function parseNonEmptyDistinctWeekdays(
  raw: unknown,
): NonEmptyDistinctWeekdays | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const days: Weekday[] = [];
  for (const item of raw) {
    const day = parseWeekday(item);
    if (!day || days.includes(day)) return null;
    days.push(day);
  }
  return Object.freeze(days) as unknown as NonEmptyDistinctWeekdays;
}

export function parseCalendarCadence(raw: unknown): CalendarCadence | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "daily":
      return hasExactlyKeys(raw, ["kind"]) ? { kind: "daily" } : null;
    case "weekly": {
      if (!hasExactlyKeys(raw, ["kind", "days"])) return null;
      const days = parseNonEmptyDistinctWeekdays(raw.days);
      return days ? { kind: "weekly", days } : null;
    }
    case "monthly": {
      if (!hasExactlyKeys(raw, ["kind", "day"])) return null;
      const day = parseDayOfMonth(raw.day);
      return day ? { kind: "monthly", day } : null;
    }
    default:
      return null;
  }
}

export function parseRecurringBountySchedule(
  raw: unknown,
): RecurringBountySchedule | null {
  if (
    !isRecord(raw) ||
    !hasExactlyKeys(raw, ["kind", "startsOn", "cadence"]) ||
    raw.kind !== "recurring"
  ) {
    return null;
  }
  const startsOn = parseLocalDate(raw.startsOn);
  const cadence = parseCalendarCadence(raw.cadence);
  return startsOn && cadence ? { kind: "recurring", startsOn, cadence } : null;
}

function weekdayIndex(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function monthlyDate(
  reference: LocalDate,
  monthOffset: number,
  day: DayOfMonth,
): LocalDate {
  const [year, month] = reference.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + monthOffset, day));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}` as LocalDate;
}

function weeklyInterval(
  schedule: RecurringBountySchedule,
  today: LocalDate,
  days: NonEmptyDistinctWeekdays,
): BountyInterval | null {
  const selected = days.map((day) => WEEKDAY_INDEX[day]);
  const todayIndex = weekdayIndex(today);
  const currentOffset = Math.min(
    ...selected.map((day) => (todayIndex - day + 7) % 7),
  );
  const start = addLocalDays(today, -currentOffset);
  if (start < schedule.startsOn) return null;
  const startIndex = weekdayIndex(start);
  const nextOffset = Math.min(
    ...selected.map((day) => (day - startIndex + 7) % 7 || 7),
  );
  return { start, next: addLocalDays(start, nextOffset) };
}

function monthlyInterval(
  schedule: RecurringBountySchedule,
  today: LocalDate,
  day: DayOfMonth,
): BountyInterval | null {
  const todayDay = Number(today.slice(8, 10));
  const start = monthlyDate(today, day <= todayDay ? 0 : -1, day);
  if (start < schedule.startsOn) return null;
  return { start, next: monthlyDate(start, 1, day) };
}

export function currentBountyInterval(
  schedule: RecurringBountySchedule,
  today: LocalDate,
): BountyInterval | null {
  if (today < schedule.startsOn) return null;
  switch (schedule.cadence.kind) {
    case "daily":
      return { start: today, next: addLocalDays(today, 1) };
    case "weekly":
      return weeklyInterval(schedule, today, schedule.cadence.days);
    case "monthly":
      return monthlyInterval(schedule, today, schedule.cadence.day);
    default: {
      const _exhaustive: never = schedule.cadence;
      return _exhaustive;
    }
  }
}
