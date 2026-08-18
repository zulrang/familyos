import type { SeriesScope } from "./types";

export function parseScope(s: unknown): SeriesScope {
  return s === "following" || s === "all" ? s : "this";
}

export function isSeriesHead(
  originalStartMs: number,
  masterStartMs: number,
): boolean {
  return (
    Math.floor(originalStartMs / 1000) === Math.floor(masterStartMs / 1000)
  );
}

/** RFC5545 UNTIL just before this occurrence (inclusive bound on the previous one). */
export function untilStamp(opts: {
  originalStartMs: number;
  allDay: boolean;
}): string {
  if (opts.allDay) {
    const d = new Date(opts.originalStartMs);
    d.setDate(d.getDate() - 1);
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  const t = new Date(opts.originalStartMs - 1000);
  return `${ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

export function rruleCount(recurrence: string[]): number | null {
  for (const line of recurrence) {
    if (!line.toUpperCase().startsWith("RRULE")) continue;
    const n = Number(parseRrule(line).map.COUNT);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export function truncateRecurrence(
  recurrence: string[],
  until: string,
  splitMs: number,
): string[] {
  return mapRecurrence(
    recurrence,
    (line) => {
      const { keys, map } = parseRrule(line);
      delete map.COUNT;
      if (!keys.includes("UNTIL")) keys.push("UNTIL");
      map.UNTIL = until;
      return formatRrule(keys, map);
    },
    (line) => filterStampLine(line, (ms) => ms < splitMs),
  );
}

export function followingRecurrence(
  recurrence: string[],
  splitMs: number,
  remainingCount: number | null,
): string[] {
  return mapRecurrence(
    recurrence,
    (line) => {
      const { keys, map } = parseRrule(line);
      if (remainingCount != null) {
        delete map.UNTIL;
        if (!keys.includes("COUNT")) keys.push("COUNT");
        map.COUNT = String(remainingCount);
      }
      return formatRrule(keys, map);
    },
    (line) => filterStampLine(line, (ms) => ms >= splitMs),
  );
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Keep WEEKLY/MONTHLY rules aligned with a new DTSTART weekday or month-day. */
export function shiftRecurrenceStart(
  recurrence: string[],
  toMs: number,
): string[] {
  const to = new Date(toMs);
  return recurrence.map((line) => {
    if (!line.toUpperCase().startsWith("RRULE")) return line;
    const { keys, map } = parseRrule(line);
    const freq = (map.FREQ ?? "").toUpperCase();
    if (freq === "WEEKLY" && map.BYDAY && !map.BYDAY.includes(",")) {
      map.BYDAY = WEEKDAYS[to.getDay()];
    }
    if (freq === "MONTHLY" && map.BYMONTHDAY && !map.BYMONTHDAY.includes(",")) {
      map.BYMONTHDAY = String(to.getDate());
    }
    return formatRrule(keys, map);
  });
}

function ymd(y: number, m: number, d: number): string {
  return `${y}${pad(m)}${pad(d)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseRrule(line: string): {
  keys: string[];
  map: Record<string, string>;
} {
  const body = line.replace(/^RRULE:/i, "");
  const keys: string[] = [];
  const map: Record<string, string> = {};
  for (const part of body.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).toUpperCase();
    keys.push(k);
    map[k] = part.slice(eq + 1);
  }
  return { keys, map };
}

function formatRrule(keys: string[], map: Record<string, string>): string {
  const ordered = ["FREQ", ...keys.filter((k) => k !== "FREQ")];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const k of ordered) {
    if (seen.has(k) || map[k] == null) continue;
    seen.add(k);
    parts.push(`${k}=${map[k]}`);
  }
  for (const k of Object.keys(map)) {
    if (seen.has(k) || map[k] == null) continue;
    seen.add(k);
    parts.push(`${k}=${map[k]}`);
  }
  return `RRULE:${parts.join(";")}`;
}

function mapRecurrence(
  recurrence: string[],
  rrule: (line: string) => string,
  stamps: (line: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const line of recurrence) {
    const u = line.toUpperCase();
    if (u.startsWith("RRULE")) out.push(rrule(line));
    else if (u.startsWith("EXDATE") || u.startsWith("RDATE")) {
      const next = stamps(line);
      if (next) out.push(next);
    } else out.push(line);
  }
  return out;
}

function filterStampLine(
  line: string,
  keep: (ms: number) => boolean,
): string | null {
  const colon = line.indexOf(":");
  if (colon === -1) return line;
  const kept = line
    .slice(colon + 1)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      const ms = stampMs(s);
      return Number.isNaN(ms) || keep(ms);
    });
  if (!kept.length) return null;
  return line.slice(0, colon + 1) + kept.join(",");
}

/** ponytail: floating stamps use the device TZ; store calendar TZ if that ever drifts. */
export function stampMs(stamp: string): number {
  const m = stamp.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
  );
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!m[4]) return new Date(y, mo - 1, d).getTime();
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  if (m[7]) return Date.UTC(y, mo - 1, d, hh, mm, ss);
  return new Date(y, mo - 1, d, hh, mm, ss).getTime();
}
