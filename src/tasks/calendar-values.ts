type Brand<T, B extends string> = T & { readonly __brand: B };

export type LocalDate = Brand<string, "LocalDate">;
export type DayOfMonth = Brand<number, "DayOfMonth">;
export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

const WEEKDAYS = new Set<string>([
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
]);

export function parseLocalDate(raw: unknown): LocalDate | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return raw as LocalDate;
}

export function parseWeekday(raw: unknown): Weekday | null {
  return typeof raw === "string" && WEEKDAYS.has(raw) ? (raw as Weekday) : null;
}

export function parseDayOfMonth(raw: unknown): DayOfMonth | null {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > 28
  ) {
    return null;
  }
  return raw as DayOfMonth;
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}` as LocalDate;
}
