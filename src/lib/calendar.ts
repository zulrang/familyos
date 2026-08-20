import { legacyToneForColor } from "./members.ts";
import type { CalEvent, Member, MemberTone } from "./types.ts";

/** Google Calendar event colorIds closest to our member pastels. Graphite (8) is multi. */
export const TONE_COLOR_ID: Record<MemberTone, string> = {
  teal: "7",
  blush: "4",
  lilac: "3",
  sage: "2",
  coral: "6",
  sand: "5",
};

export const MULTI_COLOR_ID = "8";
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

export function colorIdForTones(tones: MemberTone[]): string | null {
  if (tones.length === 1) return TONE_COLOR_ID[tones[0]];
  if (tones.length > 1) return MULTI_COLOR_ID;
  return null;
}

/** Empty/missing stored string means infer from colorId (events colored in Google Calendar). */
export function tonesFromGoogle(opts: {
  colorId?: string | null;
  stored?: string | undefined;
}): MemberTone[] {
  if (opts.stored) {
    return [
      ...new Set(
        opts.stored
          .split(",")
          .map((s) => s.trim())
          .filter(isMemberTone),
      ),
    ];
  }
  const tone = opts.colorId ? toneFromColorId(opts.colorId) : null;
  return tone ? [tone] : [];
}

export const DAY_COUNT = 7;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;
export const HOUR_PX = 120;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function weekDays(from: Date, count = DAY_COUNT): Date[] {
  const start = startOfDay(from);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function weekdayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function clockParts(d: Date): { h: number; m: number; ap: "AM" | "PM" } {
  const ap = d.getHours() >= 12 ? "PM" : "AM";
  return { h: d.getHours() % 12 || 12, m: d.getMinutes(), ap };
}

function clockText(
  p: { h: number; m: number; ap: "AM" | "PM" },
  withAp: boolean,
): string {
  const t = p.m ? `${p.h}:${String(p.m).padStart(2, "0")}` : `${p.h}`;
  return withAp ? `${t} ${p.ap}` : t;
}

export function formatTimeRange(startMs: number, endMs: number): string {
  const a = clockParts(new Date(startMs));
  const b = clockParts(new Date(endMs));
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

export function slotStart(day: Date, y: number): Date | null {
  const n = Math.floor(y / HOUR_PX);
  if (n < 0 || n >= DAY_END_HOUR - DAY_START_HOUR) return null;
  const start = new Date(day);
  start.setHours(DAY_START_HOUR + n, 0, 0, 0);
  return start;
}

export function gridHeight(): number {
  return (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
}

export function topPx(ms: number): number {
  const d = new Date(ms);
  const minutes = d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60;
  return (minutes / 60) * HOUR_PX;
}

export function heightPx(startMs: number, endMs: number): number {
  return Math.max(44, ((endMs - startMs) / 3600000) * HOUR_PX);
}

export function nowLineTop(now: Date): number {
  return topPx(now.getTime());
}

export const NOW_LINE_PX = 3;

/** Now-line offset in the day column, clamped so today always has a marker. */
export function nowLineY(now: Date): number {
  const max = Math.max(0, gridHeight() - NOW_LINE_PX);
  return Math.min(max, Math.max(0, nowLineTop(now)));
}

/** Restore a prior grid scroll. First paint keeps the now-line in view. */
export function mountGridScrollTop(saved: number | null, now: Date): number {
  if (saved != null) return saved;
  return Math.max(0, nowLineTop(now) - HOUR_PX);
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

export function peopleOf(members: Member[], event: CalEvent): Member[] {
  // ponytail: tone bridge until #7 stores participant IDs; custom/retired colors won't match.
  const tones = new Set(event.tones);
  return members.filter((m) => {
    if (m.status !== "active") return false;
    const tone = legacyToneForColor(m.color);
    return tone !== null && tones.has(tone);
  });
}

export function eventTone(people: Member[]): {
  tone: MemberTone;
  multi: boolean;
} {
  const active = people.filter((p) => p.status === "active");
  if (active.length > 1) {
    return {
      tone: legacyToneForColor(active[0].color) ?? "sand",
      multi: true,
    };
  }
  if (active.length === 1) {
    return {
      tone: legacyToneForColor(active[0].color) ?? "sand",
      multi: false,
    };
  }
  return { tone: "sand", multi: false };
}

export function coversDay(event: CalEvent, day: Date): boolean {
  const start = startOfDay(day).getTime();
  const end = addDays(startOfDay(day), 1).getTime();
  return event.startMs < end && event.endMs > start;
}

export function timedOnDay(event: CalEvent, day: Date): boolean {
  return !event.allDay && coversDay(event, day);
}

export function remainingDays(event: CalEvent, from: Date): number {
  const start = startOfDay(from).getTime();
  return Math.max(1, Math.ceil((event.endMs - start) / 86400000));
}

export function statusEvent(events: CalEvent[], today: Date): CalEvent | null {
  const start = startOfDay(today).getTime();
  const ongoing = events.filter(
    (e) => e.allDay && e.startMs <= start && e.endMs > start,
  );
  if (!ongoing.length) return null;
  return ongoing.reduce((a, b) =>
    b.endMs - b.startMs > a.endMs - a.startMs ? b : a,
  );
}

export function nextHour(from: Date): { startMs: number; endMs: number } {
  const s = new Date(from);
  s.setMinutes(0, 0, 0);
  s.setHours(s.getHours() + 1);
  return { startMs: s.getTime(), endMs: s.getTime() + 3600000 };
}

export function msToDateInput(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function msToTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fromDateAndTime(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
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

export function fromDateOnly(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}
