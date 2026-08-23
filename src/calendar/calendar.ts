import type { CalEvent } from "@/calendar/types";
import type { Member } from "@/members/members";
import {
  LEGACY_TONE_COLORS,
  legacyToneForColor,
  memberSurface,
  resolveMembers,
} from "@/members/members";
import type { MemberTone } from "@/shared/member-tone";
import {
  addZonedDays,
  msToZonedDate,
  msToZonedTime,
  startOfZonedDay,
  zonedDateTimeToMs,
  zonedHourMinute,
  zonedWeekday,
} from "@/shared/time";
import { isHouseholdEvent } from "./participants";

/** Google Calendar event colorIds closest to our member pastels. Graphite (8) is multi. Presentation only. */
export const TONE_COLOR_ID: Record<MemberTone, string> = {
  teal: "7",
  blush: "4",
  lilac: "3",
  sage: "2",
  coral: "6",
  sand: "5",
};

export const MULTI_COLOR_ID = "8";

/** @deprecated Legacy private prop; identity is PARTICIPANTS_PROP. Cleared on write. */
export const TONES_PROP = "familyosTones";

export const TONE_GOOGLE_NAME: Record<MemberTone, string> = {
  teal: "peacock",
  blush: "flamingo",
  lilac: "grape",
  sage: "sage",
  coral: "tangerine",
  sand: "banana",
};

export function isMemberTone(s: string): s is MemberTone {
  return Object.hasOwn(TONE_COLOR_ID, s);
}

export function toneFromColorId(id: string): MemberTone | null {
  for (const tone of Object.keys(TONE_COLOR_ID) as MemberTone[]) {
    if (TONE_COLOR_ID[tone] === id) return tone;
  }
  return null;
}

/** Presentation colorId for Google Calendar UI — never Event Participant identity. */
export function colorIdForTones(tones: MemberTone[]): string | null {
  if (tones.length === 1) return TONE_COLOR_ID[tones[0]];
  if (tones.length > 1) return MULTI_COLOR_ID;
  return null;
}

/** Legacy tones for Google colorId from Active Member colors. */
export function presentationTonesFor(
  members: Member[],
  participantIds: string[],
): MemberTone[] {
  const tones: MemberTone[] = [];
  for (const m of resolveMembers(members, participantIds)) {
    if (m.status !== "active") continue;
    const tone = legacyToneForColor(m.color);
    if (tone && !tones.includes(tone)) tones.push(tone);
  }
  return tones;
}

export const DAY_COUNT = 7;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;
export const HOUR_PX = 120;

export function startOfDay(d: Date, timeZone: string): Date {
  return startOfZonedDay(d, timeZone);
}

export function addDays(d: Date, n: number, timeZone: string): Date {
  return addZonedDays(d, n, timeZone);
}

export function weekDays(
  from: Date,
  timeZone: string,
  count = DAY_COUNT,
): Date[] {
  const start = startOfDay(from, timeZone);
  return Array.from({ length: count }, (_, i) => addDays(start, i, timeZone));
}

export function weekdayLabel(d: Date, timeZone: string): string {
  return zonedWeekday(d, timeZone);
}

export function isSameDay(a: Date, b: Date, timeZone: string): boolean {
  return (
    startOfDay(a, timeZone).getTime() === startOfDay(b, timeZone).getTime()
  );
}

function clockParts(
  ms: number,
  timeZone: string,
): { h: number; m: number; ap: "AM" | "PM" } {
  const { hour, minute } = zonedHourMinute(ms, timeZone);
  const ap = hour >= 12 ? "PM" : "AM";
  return { h: hour % 12 || 12, m: minute, ap };
}

function clockText(
  p: { h: number; m: number; ap: "AM" | "PM" },
  withAp: boolean,
): string {
  const t = p.m ? `${p.h}:${String(p.m).padStart(2, "0")}` : `${p.h}`;
  return withAp ? `${t} ${p.ap}` : t;
}

export function formatTimeRange(
  startMs: number,
  endMs: number,
  timeZone: string,
): string {
  const a = clockParts(startMs, timeZone);
  const b = clockParts(endMs, timeZone);
  if (a.ap === b.ap) return `${clockText(a, false)} - ${clockText(b, true)}`;
  return `${clockText(a, true)} - ${clockText(b, true)}`;
}

export function hoursInView(): string[] {
  const out: string[] = [];
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
    const ap = h >= 12 ? "PM" : "AM";
    out.push(`${h % 12 || 12} ${ap}`);
  }
  return out;
}

export function slotStart(day: Date, y: number, timeZone: string): Date | null {
  const n = Math.floor(y / HOUR_PX);
  if (n < 0 || n >= DAY_END_HOUR - DAY_START_HOUR) return null;
  const date = msToZonedDate(day.getTime(), timeZone);
  const hour = DAY_START_HOUR + n;
  return new Date(
    zonedDateTimeToMs(date, `${String(hour).padStart(2, "0")}:00`, timeZone),
  );
}

export function gridHeight(): number {
  return (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
}

export function topPx(ms: number, timeZone: string): number {
  const { hour, minute } = zonedHourMinute(ms, timeZone);
  const minutes = hour * 60 + minute - DAY_START_HOUR * 60;
  return (minutes / 60) * HOUR_PX;
}

export function heightPx(startMs: number, endMs: number): number {
  return Math.max(44, ((endMs - startMs) / 3600000) * HOUR_PX);
}

export function nowLineTop(now: Date, timeZone: string): number {
  return topPx(now.getTime(), timeZone);
}

export const NOW_LINE_PX = 3;

/** Now-line offset in the day column, clamped so today always has a marker. */
export function nowLineY(now: Date, timeZone: string): number {
  const max = Math.max(0, gridHeight() - NOW_LINE_PX);
  return Math.min(max, Math.max(0, nowLineTop(now, timeZone)));
}

/** Restore a prior grid scroll. First paint keeps the now-line in view. */
export function mountGridScrollTop(
  saved: number | null,
  now: Date,
  timeZone: string,
): number {
  if (saved != null) return saved;
  return Math.max(0, nowLineTop(now, timeZone) - HOUR_PX);
}

export type LaidOut<T> = T & { col: number; cols: number };

export function layoutColumns<T extends { startMs: number; endMs: number }>(
  events: T[],
): LaidOut<T>[] {
  const sorted = [...events].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  const result: LaidOut<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const assigned = new Map<T, number>();
    for (const e of cluster) {
      let col = colEnds.findIndex((end) => end <= e.startMs);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(e.endMs);
      } else {
        colEnds[col] = e.endMs;
      }
      assigned.set(e, col);
    }
    const cols = colEnds.length;
    for (const e of cluster) {
      result.push({ ...e, col: assigned.get(e) ?? 0, cols });
    }
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const e of sorted) {
    if (cluster.length && e.startMs >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMs);
  }
  flush();
  return result;
}

/** Resolve Event Participants by stable ID — includes Retired Members. */
export function peopleOf(members: Member[], event: CalEvent): Member[] {
  return resolveMembers(members, event.participantIds);
}

/** Household Events stay visible; otherwise any non-filtered resolved participant. */
export function visibleUnderMemberFilter(
  event: CalEvent,
  members: Member[],
  off: Record<string, boolean>,
): boolean {
  if (isHouseholdEvent(event.participantIds)) return true;
  const people = peopleOf(members, event);
  return people.some((p) => !off[p.id]);
}

export function eventTone(people: Member[]): {
  tone: MemberTone;
  multi: boolean;
} {
  const multi = people.length > 1;
  for (const p of people) {
    if (p.status !== "active") continue;
    const tone = legacyToneForColor(p.color);
    if (tone) return { tone, multi };
  }
  return { tone: "sand", multi };
}

export function eventPaint(people: Member[]): {
  multi: boolean;
  fill: string;
  soft: string;
} {
  const multi = people.length > 1;
  const active = people.filter((p) => p.status === "active");
  if (active.length === 1) {
    const surface = memberSurface(active[0].color);
    return { multi, fill: surface.fill, soft: surface.soft };
  }
  const sand = memberSurface(LEGACY_TONE_COLORS.sand);
  return { multi, fill: sand.fill, soft: sand.soft };
}

export function coversDay(
  event: CalEvent,
  day: Date,
  timeZone: string,
): boolean {
  const start = startOfDay(day, timeZone).getTime();
  const end = addDays(startOfDay(day, timeZone), 1, timeZone).getTime();
  return event.startMs < end && event.endMs > start;
}

export function timedOnDay(
  event: CalEvent,
  day: Date,
  timeZone: string,
): boolean {
  return !event.allDay && coversDay(event, day, timeZone);
}

export function remainingDays(
  event: CalEvent,
  from: Date,
  timeZone: string,
): number {
  const start = startOfDay(from, timeZone);
  if (event.endMs <= start.getTime()) return 1;
  let n = 0;
  let d = start;
  while (d.getTime() < event.endMs) {
    n += 1;
    d = addDays(d, 1, timeZone);
    // ponytail: civil-day walk; 4000-day cap. Count from YMD if multi-year spans show up.
    if (n > 4000) break;
  }
  return Math.max(1, n);
}

export function statusEvent(
  events: CalEvent[],
  today: Date,
  timeZone: string,
): CalEvent | null {
  const start = startOfDay(today, timeZone).getTime();
  const ongoing = events.filter(
    (e) => e.allDay && e.startMs <= start && e.endMs > start,
  );
  if (!ongoing.length) return null;
  return ongoing.reduce((a, b) =>
    b.endMs - b.startMs > a.endMs - a.startMs ? b : a,
  );
}

export function nextHour(
  from: Date,
  timeZone: string,
): { startMs: number; endMs: number } {
  const date = msToZonedDate(from.getTime(), timeZone);
  const { hour } = zonedHourMinute(from.getTime(), timeZone);
  let nextH = hour + 1;
  let nextDate = date;
  if (nextH >= 24) {
    nextH = 0;
    nextDate = msToZonedDate(addDays(from, 1, timeZone).getTime(), timeZone);
  }
  const startMs = zonedDateTimeToMs(
    nextDate,
    `${String(nextH).padStart(2, "0")}:00`,
    timeZone,
  );
  return { startMs, endMs: startMs + 3600000 };
}

export function msToDateInput(ms: number, timeZone: string): string {
  return msToZonedDate(ms, timeZone);
}

export function msToTimeInput(ms: number, timeZone: string): string {
  return msToZonedTime(ms, timeZone);
}

export function fromDateAndTime(
  date: string,
  time: string,
  timeZone: string,
): number {
  return zonedDateTimeToMs(date, time, timeZone);
}

/** Clock digits in `timeZone` when set; otherwise a UTC instant. */
export function googleDateTime(
  ms: number,
  timeZone?: string,
): { dateTime: string; timeZone?: string } {
  if (!timeZone) return { dateTime: new Date(ms).toISOString() };
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return {
    dateTime: `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`,
    timeZone,
  };
}

export function fromDateOnly(date: string, timeZone: string): number {
  return zonedDateTimeToMs(date, "00:00", timeZone);
}
