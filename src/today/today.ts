import {
  addDays,
  coversDay,
  DAY_END_HOUR,
  DAY_START_HOUR,
  HOUR_PX,
  type LaidOut,
  layoutColumns,
  startOfDay,
} from "@/calendar/calendar";
import type { CalEvent } from "@/calendar/types";
import type { ActiveMember, MemberId } from "@/members/members";
import {
  msToZonedDate,
  zonedDateTimeToMs,
  zonedHourMinute,
} from "@/shared/time";

export type TodayFilter =
  | { kind: "everyone" }
  | { kind: "member"; member: MemberId };

export type DayLane = { member: ActiveMember; events: LaidOut<CalEvent>[] };

export type DayLanes = {
  bands: LaidOut<CalEvent>[];
  lanes: DayLane[];
};

const VISIBLE_HOURS = DAY_END_HOUR - DAY_START_HOUR;
const MIN_HOUR_PX = 48;
const MIN_BLOCK_PX = 36;
export const DEFAULT_HOUR_PX = 60;

export function dayRange(
  day: Date,
  timeZone: string,
): { from: string; to: string } {
  const start = startOfDay(day, timeZone);
  return {
    from: start.toISOString(),
    to: addDays(start, 1, timeZone).toISOString(),
  };
}

export function activeEventParticipants(
  event: CalEvent,
  members: readonly ActiveMember[],
): MemberId[] {
  return members
    .filter((member) => event.participantIds.includes(member.id))
    .map((member) => member.id);
}

function overlaps(a: CalEvent, b: CalEvent): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function dayLanes(
  events: readonly CalEvent[],
  members: readonly ActiveMember[],
  day: Date,
  timeZone: string,
): DayLanes {
  const timed = events.filter(
    (event) => !event.allDay && coversDay(event, day, timeZone),
  );
  const withParticipants = timed.filter(
    (event) => activeEventParticipants(event, members).length > 0,
  );
  const forEveryone = timed.filter(
    (event) => activeEventParticipants(event, members).length === 0,
  );
  const spansAllLanes = (event: CalEvent) =>
    !withParticipants.some((other) => overlaps(event, other));
  const overlappingForEveryone = forEveryone.filter(
    (event) => !spansAllLanes(event),
  );
  return {
    bands: layoutColumns(forEveryone.filter(spansAllLanes)),
    lanes: members.map((member) => ({
      member,
      events: layoutColumns([
        ...withParticipants.filter((event) =>
          event.participantIds.includes(member.id),
        ),
        ...overlappingForEveryone,
      ]),
    })),
  };
}

export function memberDayLane(
  events: readonly CalEvent[],
  member: ActiveMember,
  members: readonly ActiveMember[],
  day: Date,
  timeZone: string,
): LaidOut<CalEvent>[] {
  return layoutColumns(
    events.filter((event) => {
      if (event.allDay || !coversDay(event, day, timeZone)) return false;
      const participants = activeEventParticipants(event, members);
      return participants.length === 0 || participants.includes(member.id);
    }),
  );
}

export function allDayEvents(
  events: readonly CalEvent[],
  members: readonly ActiveMember[],
  filter: TodayFilter,
  day: Date,
  timeZone: string,
): CalEvent[] {
  return events
    .filter((event) => {
      if (!event.allDay || !coversDay(event, day, timeZone)) return false;
      const participants = activeEventParticipants(event, members);
      return (
        filter.kind === "everyone" ||
        participants.length === 0 ||
        participants.includes(filter.member)
      );
    })
    .sort(
      (a, b) =>
        activeEventParticipants(a, members).length -
          activeEventParticipants(b, members).length ||
        a.title.localeCompare(b.title),
    );
}

export function hourHeight(viewportPx: number): number {
  if (viewportPx <= 0) return DEFAULT_HOUR_PX;
  return Math.min(
    HOUR_PX,
    Math.max(MIN_HOUR_PX, Math.floor(viewportPx / VISIBLE_HOURS)),
  );
}

export function gridHeight(hourPx: number): number {
  return VISIBLE_HOURS * hourPx;
}

function clampedWindowMinutes(ms: number, day: Date, timeZone: string): number {
  const dayStart = startOfDay(day, timeZone).getTime();
  const dayEnd = addDays(new Date(dayStart), 1, timeZone).getTime();
  const { hour, minute } = zonedHourMinute(ms, timeZone);
  const ofDay =
    ms <= dayStart ? 0 : ms >= dayEnd ? 24 * 60 : hour * 60 + minute;
  return Math.min(VISIBLE_HOURS * 60, Math.max(0, ofDay - DAY_START_HOUR * 60));
}

export function eventBox(
  event: { startMs: number; endMs: number },
  day: Date,
  timeZone: string,
  hourPx: number,
): { top: number; height: number } {
  const start =
    (clampedWindowMinutes(event.startMs, day, timeZone) / 60) * hourPx;
  const end = (clampedWindowMinutes(event.endMs, day, timeZone) / 60) * hourPx;
  const height = Math.max(MIN_BLOCK_PX, end - start);
  return { top: Math.min(start, gridHeight(hourPx) - height), height };
}

export function nowOffset(
  now: Date,
  timeZone: string,
  hourPx: number,
): number | null {
  const { hour, minute } = zonedHourMinute(now.getTime(), timeZone);
  if (hour < DAY_START_HOUR || hour >= DAY_END_HOUR) return null;
  return ((hour - DAY_START_HOUR) * 60 + minute) * (hourPx / 60);
}

export function hourAt(
  day: Date,
  y: number,
  timeZone: string,
  hourPx: number,
): Date | null {
  const n = Math.floor(y / hourPx);
  if (n < 0 || n >= VISIBLE_HOURS) return null;
  const hour = String(DAY_START_HOUR + n).padStart(2, "0");
  return new Date(
    zonedDateTimeToMs(
      msToZonedDate(day.getTime(), timeZone),
      `${hour}:00`,
      timeZone,
    ),
  );
}
