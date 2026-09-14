import {
  type BountyRecurrence,
  bountyIntervalForCadence,
  type CalendarCadence,
  parseCalendarCadence,
} from "./bounty-calendar";
import type { LegacyTaskDefinition, LocalDate, Weekday } from "./types";

const WEEKDAYS: readonly Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

function legacyCadence(
  recurrence: Exclude<LegacyTaskDefinition["recurrence"], { kind: "once" }>,
): CalendarCadence {
  const raw =
    recurrence.kind === "weekly"
      ? {
          kind: "weekly",
          days: WEEKDAYS.filter((day) => recurrence.days.includes(day)),
        }
      : recurrence;
  const cadence = parseCalendarCadence(raw);
  if (!cadence) throw new Error("Invalid legacy Bounty cadence");
  return cadence;
}

export function legacyIntervalStart(
  cadence: CalendarCadence,
  date: LocalDate,
): LocalDate {
  return bountyIntervalForCadence(cadence, date).start;
}

export function legacyBountySchedule(
  definition: LegacyTaskDefinition,
  today: LocalDate,
  representedWindows: readonly LocalDate[],
): BountyRecurrence {
  if (definition.recurrence.kind === "once") return { kind: "once" };
  const cadence = legacyCadence(definition.recurrence);
  const reference = definition.retiredAt ?? today;
  const startsOn = [reference, ...representedWindows]
    .map((date) => legacyIntervalStart(cadence, date))
    .sort()[0];
  if (!startsOn) throw new Error("Legacy Bounty schedule needs a start date");
  return { kind: "recurring", startsOn, cadence };
}
