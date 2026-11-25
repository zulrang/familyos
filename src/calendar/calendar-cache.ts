import { readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { CalEvent } from "@/calendar/types";
import { dataDir } from "@/shared/data-path";
import { writeAtomicJson } from "@/shared/json-file";

export const MAX_CACHED_RANGES = 8;

let touchCounter = 0;
const touchedOrder = new Map<string, number>();

function cacheRoot(): string {
  return path.join(dataDir(), "cache", "calendar");
}

function safeSegment(id: string): string {
  return encodeURIComponent(id);
}

function eventsFile(
  connectionId: string,
  calendarId: string,
  from: string,
  to: string,
): string {
  return path.join(
    cacheRoot(),
    safeSegment(connectionId),
    safeSegment(calendarId),
    `${safeSegment(from)}__${safeSegment(to)}.json`,
  );
}

function parseEvent(raw: unknown): CalEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  if (typeof o.allDay !== "boolean") return null;
  if (typeof o.startMs !== "number" || typeof o.endMs !== "number") return null;
  if (
    !Array.isArray(o.participantIds) ||
    o.participantIds.some((id) => typeof id !== "string")
  ) {
    return null;
  }
  const event: CalEvent = {
    id: o.id,
    title: o.title,
    allDay: o.allDay,
    startMs: o.startMs,
    endMs: o.endMs,
    participantIds: o.participantIds,
    // DESIGN-DEVIATION: empty expectedVersion renders pre-version cache rows read-only.
    expectedVersion:
      typeof o.expectedVersion === "string" ? o.expectedVersion : "",
  };
  if (typeof o.recurringEventId === "string") {
    event.recurringEventId = o.recurringEventId;
  }
  if (typeof o.originalStartMs === "number") {
    event.originalStartMs = o.originalStartMs;
  }
  return event;
}

function parseEvents(raw: unknown): CalEvent[] | null {
  if (!Array.isArray(raw)) return null;
  const events: CalEvent[] = [];
  for (const row of raw) {
    const event = parseEvent(row);
    if (!event) return null;
    events.push(event);
  }
  return events;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export async function pruneCalendarCache(
  connectionId: string,
  calendarId: string,
  maxRanges = MAX_CACHED_RANGES,
  keepFileName?: string,
): Promise<void> {
  const dir = namespaceDir(connectionId, calendarId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }
  if (names.length <= maxRanges) return;
  const entries = await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      const info = await stat(full).catch(() => null);
      return {
        name,
        full,
        mtimeMs: info?.mtimeMs ?? 0,
        order: touchedOrder.get(full) ?? 0,
      };
    }),
  );
  entries.sort((a, b) => {
    if (keepFileName) {
      if (a.name === keepFileName && b.name !== keepFileName) return -1;
      if (b.name === keepFileName && a.name !== keepFileName) return 1;
    }
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    if (b.order !== a.order) return b.order - a.order;
    return b.name.localeCompare(a.name);
  });
  await Promise.all(
    entries.slice(maxRanges).map(async (entry) => {
      touchedOrder.delete(entry.full);
      await unlink(entry.full).catch(() => undefined);
    }),
  );
}

export async function putCalendarEventsCache(
  connectionId: string,
  calendarId: string,
  from: string,
  to: string,
  events: CalEvent[],
  maxRanges = MAX_CACHED_RANGES,
): Promise<void> {
  const file = eventsFile(connectionId, calendarId, from, to);
  await writeAtomicJson(file, events);
  touchedOrder.set(file, ++touchCounter);
  await pruneCalendarCache(
    connectionId,
    calendarId,
    maxRanges,
    path.basename(file),
  );
}

export async function getCalendarEventsCache(
  connectionId: string,
  calendarId: string,
  from: string,
  to: string,
): Promise<CalEvent[] | null> {
  return parseEvents(
    await readJson(eventsFile(connectionId, calendarId, from, to)),
  );
}

function namespaceDir(connectionId: string, calendarId: string): string {
  return path.join(
    cacheRoot(),
    safeSegment(connectionId),
    safeSegment(calendarId),
  );
}

export async function listCalendarCacheRanges(
  connectionId: string,
  calendarId: string,
): Promise<{ from: string; to: string }[]> {
  try {
    const names = await readdir(namespaceDir(connectionId, calendarId));
    const ranges: { from: string; to: string }[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const split = name.slice(0, -".json".length).split("__");
      if (split.length !== 2 || !split[0] || !split[1]) continue;
      ranges.push({
        from: decodeURIComponent(split[0]),
        to: decodeURIComponent(split[1]),
      });
    }
    return ranges;
  } catch {
    return [];
  }
}
