/** Household Time Zone: IANA identifier that every Display uses for dates. */

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value === "UTC") return true;
  // ponytail: DateTimeFormat accepts POSIX abbreviations (EST); IANA ids have a '/'.
  if (!value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function fallbackTimeZone(): string {
  return "UTC";
}

export function parseTimeZone(
  raw: unknown,
  fallback = fallbackTimeZone(),
): string {
  if (isIanaTimeZone(raw)) return raw;
  return isIanaTimeZone(fallback) ? fallback : "UTC";
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(ms: number, timeZone: string): ZonedParts {
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
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function tzOffsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - instant;
}

/** Wall clock in `timeZone` → UTC instant. DST gaps/overlaps pick one side. */
export function zonedDateTimeToMs(
  date: string,
  time: string,
  timeZone: string,
): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return zonedPartsToMs(y, m, d, hh, mm, 0, timeZone);
}

function zonedPartsToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = tzOffsetMs(utcGuess, timeZone);
  let instant = utcGuess - offset;
  const offset2 = tzOffsetMs(instant, timeZone);
  if (offset2 !== offset) instant = utcGuess - offset2;
  return instant;
}

export function msToZonedDate(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function msToZonedTime(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant.getTime(), timeZone);
  return new Date(zonedPartsToMs(p.year, p.month, p.day, 0, 0, 0, timeZone));
}

export function addZonedDays(instant: Date, n: number, timeZone: string): Date {
  const p = zonedParts(instant.getTime(), timeZone);
  const civil = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return new Date(
    zonedPartsToMs(
      civil.getUTCFullYear(),
      civil.getUTCMonth() + 1,
      civil.getUTCDate(),
      p.hour,
      p.minute,
      p.second,
      timeZone,
    ),
  );
}

export function zonedDayOfMonth(instant: Date, timeZone: string): number {
  return zonedParts(instant.getTime(), timeZone).day;
}

/** 0 = Sunday. Civil date in `timeZone`, not the host calendar. */
export function zonedWeekdayIndex(ms: number, timeZone: string): number {
  const [y, m, d] = msToZonedDate(ms, timeZone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function zonedWeekday(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(instant);
}

export function zonedHourMinute(
  ms: number,
  timeZone: string,
): { hour: number; minute: number } {
  const p = zonedParts(ms, timeZone);
  return { hour: p.hour, minute: p.minute };
}

export function formatClock(d: Date, timeZone: string): string {
  return d.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}
