import {
  addLocalDays,
  type DayOfMonth,
  type LocalDate,
  parseDayOfMonth,
  parseLocalDate,
  parseWeekday,
  type Weekday,
} from "./calendar-values";

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

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

export type BountyRecurrence =
  | Readonly<{ kind: "once" }>
  | RecurringBountySchedule;

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

export function parseBountyRecurrence(raw: unknown): BountyRecurrence | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "once")
    return hasExactlyKeys(raw, ["kind"]) ? { kind: "once" } : null;
  return parseRecurringBountySchedule(raw);
}

export function sameBountyRecurrence(
  left: BountyRecurrence,
  right: BountyRecurrence,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "once" || right.kind === "once") return true;
  if (
    left.startsOn !== right.startsOn ||
    left.cadence.kind !== right.cadence.kind
  ) {
    return false;
  }
  switch (left.cadence.kind) {
    case "daily":
      return right.cadence.kind === "daily";
    case "monthly":
      return (
        right.cadence.kind === "monthly" &&
        left.cadence.day === right.cadence.day
      );
    case "weekly": {
      if (right.cadence.kind !== "weekly") return false;
      const rightDays = right.cadence.days;
      return (
        left.cadence.days.length === rightDays.length &&
        left.cadence.days.every((day) => rightDays.includes(day))
      );
    }
  }
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
  today: LocalDate,
  days: NonEmptyDistinctWeekdays,
): BountyInterval {
  const selected = days.map((day) => WEEKDAY_INDEX[day]);
  const todayIndex = weekdayIndex(today);
  const currentOffset = Math.min(
    ...selected.map((day) => (todayIndex - day + 7) % 7),
  );
  const start = addLocalDays(today, -currentOffset);
  const startIndex = weekdayIndex(start);
  const nextOffset = Math.min(
    ...selected.map((day) => (day - startIndex + 7) % 7 || 7),
  );
  return { start, next: addLocalDays(start, nextOffset) };
}

function monthlyInterval(today: LocalDate, day: DayOfMonth): BountyInterval {
  const todayDay = Number(today.slice(8, 10));
  const start = monthlyDate(today, day <= todayDay ? 0 : -1, day);
  return { start, next: monthlyDate(start, 1, day) };
}

export function bountyIntervalForCadence(
  cadence: CalendarCadence,
  date: LocalDate,
): BountyInterval {
  switch (cadence.kind) {
    case "daily":
      return { start: date, next: addLocalDays(date, 1) };
    case "weekly":
      return weeklyInterval(date, cadence.days);
    case "monthly":
      return monthlyInterval(date, cadence.day);
    default: {
      const _exhaustive: never = cadence;
      return _exhaustive;
    }
  }
}

export function currentBountyInterval(
  schedule: RecurringBountySchedule,
  today: LocalDate,
): BountyInterval | null {
  if (today < schedule.startsOn) return null;
  const interval = bountyIntervalForCadence(schedule.cadence, today);
  return interval.start < schedule.startsOn ? null : interval;
}
