import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CalEvent } from "@/calendar/types";
import { dataDir } from "@/shared/data-path";

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
    // DESIGN-DEVIATION: pre-version cache rows still display; empty token
    // cannot mutate because HTTP requires a non-empty expectedVersion.
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

export async function putCalendarEventsCache(
  connectionId: string,
  calendarId: string,
  from: string,
  to: string,
  events: CalEvent[],
): Promise<void> {
  const file = eventsFile(connectionId, calendarId, from, to);
  await mkdir(path.dirname(file), { recursive: true });
  // ponytail: last-write-wins JSON; upgrade if cache writes start racing.
  await writeFile(file, `${JSON.stringify(events)}\n`);
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
