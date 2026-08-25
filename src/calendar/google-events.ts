import {
  colorIdForLegacyTones,
  fromDateOnly,
  googleDateTime,
  LEGACY_TONES_PROP,
  msToDateInput,
} from "@/calendar/calendar";
import {
  normalizeParticipantIds,
  PARTICIPANTS_PROP,
  parseParticipantIds,
  serializeParticipantIds,
} from "@/calendar/participants";
import {
  followingRecurrence,
  isSeriesHead,
  rruleCount,
  shiftRecurrenceStart,
  truncateRecurrence,
  untilStamp,
} from "@/calendar/recurrence";
import type { CalEvent, GoogleCalendar, SeriesScope } from "@/calendar/types";
import type { LegacyTone } from "@/members/members";
import { gfetch } from "@/shared/google";
import { EventConflictError } from "./calendar-error";

export async function listCalendars(): Promise<GoogleCalendar[]> {
  const res = await gfetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  );
  if (!res.ok) throw new Error(`calendarList ${res.status}`);
  const data = (await res.json()) as {
    items?: {
      id: string;
      summary: string;
      primary?: boolean;
      timeZone?: string;
    }[];
  };
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary,
    timeZone: c.timeZone,
  }));
}

type GDate = { dateTime?: string; date?: string; timeZone?: string };
type GEvent = {
  id?: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GDate;
  end?: GDate;
  attendees?: { email?: string }[];
  colorId?: string | null;
  recurringEventId?: string;
  originalStartTime?: GDate;
  recurrence?: string[];
  reminders?: unknown;
  status?: string;
  extendedProperties?: { private?: Record<string, string | null> };
};

function parseGDate(
  d: GDate | undefined,
  timeZone: string,
): { ms: number; allDay: boolean } | null {
  if (!d) return null;
  if (d.dateTime) return { ms: new Date(d.dateTime).getTime(), allDay: false };
  if (d.date) return { ms: fromDateOnly(d.date, timeZone), allDay: true };
  return null;
}

function toCalEvent(g: GEvent, timeZone: string): CalEvent | null {
  if (!g.id) return null;
  const start = parseGDate(g.start, timeZone);
  const end = parseGDate(g.end, timeZone);
  if (!start || !end) return null;
  const stored = g.extendedProperties?.private?.[PARTICIPANTS_PROP];
  const original = parseGDate(g.originalStartTime, timeZone);
  return {
    id: g.id,
    title: g.summary || "Busy",
    allDay: start.allDay,
    startMs: start.ms,
    endMs: end.ms,
    // Identity from private IDs only — never colorId or attendees.
    participantIds: parseParticipantIds(
      stored === undefined || stored === null ? undefined : stored,
    ),
    expectedVersion: g.etag ?? "", // DESIGN-DEVIATION: live Google may omit etag; empty cannot mutate (HTTP requires a token)
    recurringEventId: g.recurringEventId,
    originalStartMs: original?.ms,
  };
}

export async function listEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  timeZone: string,
): Promise<CalEvent[]> {
  const events: CalEvent[] = [];
  let pageToken = "";
  for (;;) {
    const u = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("orderBy", "startTime");
    u.searchParams.set("timeMin", timeMin);
    u.searchParams.set("timeMax", timeMax);
    u.searchParams.set("maxResults", "250");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await gfetch(u.toString());
    if (!res.ok) throw new Error(`events ${res.status}`);
    const data = (await res.json()) as {
      items?: GEvent[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      const ev = toCalEvent(item, timeZone);
      if (ev) events.push(ev);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return events;
}

export type EventWrite = {
  title: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  participantIds: string[];
  /** Google colorId only — never Event Participant identity. */
  legacyTones?: LegacyTone[];
};

function gBody(
  w: EventWrite,
  mode: "insert" | "update",
  timeZone: string,
): Record<string, unknown> {
  const participantIds = normalizeParticipantIds(w.participantIds);
  const tones = w.legacyTones ?? [];
  let start: GDate;
  let end: GDate;
  if (w.allDay) {
    start = { date: msToDateInput(w.startMs, timeZone) };
    end = { date: msToDateInput(w.endMs, timeZone) };
  } else {
    start = googleDateTime(w.startMs, timeZone);
    end = googleDateTime(w.endMs, timeZone);
  }
  const body: Record<string, unknown> = {
    summary: w.title,
    start,
    end,
  };
  const colorId = colorIdForLegacyTones(tones);
  if (colorId) body.colorId = colorId;
  else if (mode === "update") body.colorId = null;
  // ponytail: Google 400s on null private props ("Required"); "" clears prior lists.
  // Also wipe legacy familyosTones so tone-as-identity can't linger beside IDs.
  const privateProps: Record<string, string> = {
    [PARTICIPANTS_PROP]: serializeParticipantIds(participantIds),
  };
  if (mode === "update") privateProps[LEGACY_TONES_PROP] = "";
  if (participantIds.length > 0 || mode === "update") {
    body.extendedProperties = { private: privateProps };
  }
  return body;
}

export async function insertEvent(
  calendarId: string,
  w: EventWrite,
  timeZone: string,
): Promise<CalEvent> {
  const res = await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    { method: "POST", body: JSON.stringify(gBody(w, "insert", timeZone)) },
  );
  if (!res.ok) {
    throw new Error(`insert ${res.status} ${await res.text()}`);
  }
  const ev = toCalEvent((await res.json()) as GEvent, timeZone);
  if (!ev) throw new Error("insert returned no event");
  return ev;
}

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

async function getGEvent(calendarId: string, eventId: string): Promise<GEvent> {
  const res = await gfetch(eventsUrl(calendarId, eventId));
  if (!res.ok) throw new Error(`get ${res.status} ${await res.text()}`);
  return res.json() as Promise<GEvent>;
}

async function currentEvent(
  calendarId: string,
  eventId: string,
  timeZone: string,
): Promise<CalEvent | null> {
  const res = await gfetch(eventsUrl(calendarId, eventId));
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`get ${res.status}`);
  return toCalEvent((await res.json()) as GEvent, timeZone);
}

async function rejectIfStale(
  res: Response,
  calendarId: string,
  eventId: string,
  timeZone: string,
): Promise<void> {
  if (res.status !== 412) return;
  throw new EventConflictError(
    await currentEvent(calendarId, eventId, timeZone),
  );
}

async function patchGEvent(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
  expectedVersion: string,
  requestedEventId: string,
  timeZone: string,
): Promise<GEvent> {
  const res = await gfetch(
    `${eventsUrl(calendarId, eventId)}?sendUpdates=none`,
    {
      method: "PATCH",
      headers: { "If-Match": expectedVersion },
      body: JSON.stringify(body),
    },
  );
  await rejectIfStale(res, calendarId, requestedEventId, timeZone);
  if (!res.ok) throw new Error(`update ${res.status} ${await res.text()}`);
  return res.json() as Promise<GEvent>;
}

async function calFromPatch(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
  timeZone: string,
  expectedVersion: string,
  requestedEventId: string,
): Promise<CalEvent> {
  const ev = toCalEvent(
    await patchGEvent(
      calendarId,
      eventId,
      body,
      expectedVersion,
      requestedEventId,
      timeZone,
    ),
    timeZone,
  );
  if (!ev) throw new Error("update returned no event");
  return ev;
}

function writeForMaster(
  master: GEvent,
  instance: GEvent,
  w: EventWrite,
  timeZone: string,
): EventWrite {
  const orig = parseGDate(
    instance.originalStartTime ?? instance.start,
    timeZone,
  );
  const mStart = parseGDate(master.start, timeZone);
  if (!orig || !mStart) return w;
  const duration = w.endMs - w.startMs;
  return {
    ...w,
    startMs: mStart.ms + (w.startMs - orig.ms),
    endMs: mStart.ms + (w.startMs - orig.ms) + duration,
  };
}

async function countInstancesBefore(
  calendarId: string,
  masterId: string,
  splitMs: number,
  timeZone: string,
): Promise<number> {
  let n = 0;
  let pageToken = "";
  for (;;) {
    const u = new URL(`${eventsUrl(calendarId, masterId)}/instances`);
    u.searchParams.set("timeMax", new Date(splitMs + 86400000).toISOString());
    u.searchParams.set("maxResults", "2500");
    u.searchParams.set("showDeleted", "false");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await gfetch(u.toString());
    if (!res.ok) throw new Error(`instances ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      items?: GEvent[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      if (item.status === "cancelled") continue;
      const s = parseGDate(item.originalStartTime ?? item.start, timeZone);
      if (s && s.ms < splitMs) n++;
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return n;
}

async function updateFollowing(
  calendarId: string,
  master: GEvent,
  orig: { ms: number; allDay: boolean },
  w: EventWrite,
  timeZone: string,
  masterVersion: string,
  requestedEventId: string,
): Promise<CalEvent> {
  const masterId = master.id;
  if (!masterId) throw new Error("master has no id");
  const recurrence = master.recurrence ?? [];
  const until = untilStamp({
    originalStartMs: orig.ms,
    allDay: orig.allDay,
    timeZone,
  });
  const oldRec = truncateRecurrence(recurrence, until, orig.ms, timeZone);
  const count = rruleCount(recurrence);
  const remaining =
    count == null
      ? null
      : Math.max(
          1,
          count -
            (await countInstancesBefore(
              calendarId,
              masterId,
              orig.ms,
              timeZone,
            )),
        );
  const newRec = shiftRecurrenceStart(
    followingRecurrence(recurrence, orig.ms, remaining, timeZone),
    w.startMs,
    timeZone,
  );
  const insertBody: Record<string, unknown> = {
    ...gBody(w, "insert", timeZone),
    recurrence: newRec,
  };
  if (master.description) insertBody.description = master.description;
  if (master.location) insertBody.location = master.location;
  if (master.reminders) insertBody.reminders = master.reminders;
  const truncated = await patchGEvent(
    calendarId,
    masterId,
    { recurrence: oldRec },
    masterVersion,
    requestedEventId,
    timeZone,
  );
  try {
    const res = await gfetch(`${eventsUrl(calendarId)}?sendUpdates=none`, {
      method: "POST",
      body: JSON.stringify(insertBody),
    });
    if (!res.ok) throw new Error(`insert ${res.status} ${await res.text()}`);
    const ev = toCalEvent((await res.json()) as GEvent, timeZone);
    if (!ev) throw new Error("insert returned no event");
    return ev;
  } catch (e) {
    await patchGEvent(
      calendarId,
      masterId,
      { recurrence },
      truncated.etag ?? "",
      requestedEventId,
      timeZone,
    );
    throw e;
  }
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  w: EventWrite,
  scope: SeriesScope = "this",
  timeZone: string,
  expectedVersion: string,
): Promise<CalEvent> {
  if (scope === "this") {
    return calFromPatch(
      calendarId,
      eventId,
      gBody(w, "update", timeZone),
      timeZone,
      expectedVersion,
      eventId,
    );
  }
  const instance = await getGEvent(calendarId, eventId);
  if ((instance.etag ?? "") !== expectedVersion) {
    throw new EventConflictError(toCalEvent(instance, timeZone));
  }
  const masterId = instance.recurringEventId;
  if (!masterId) {
    return calFromPatch(
      calendarId,
      eventId,
      gBody(w, "update", timeZone),
      timeZone,
      expectedVersion,
      eventId,
    );
  }
  const master = await getGEvent(calendarId, masterId);
  const orig = parseGDate(
    instance.originalStartTime ?? instance.start,
    timeZone,
  );
  const mStart = parseGDate(master.start, timeZone);
  // ponytail: series writes If-Match the master's current etag (an instance
  // token cannot If-Match a different resource). The instance token is checked
  // above so a stale Display still 409s; concurrent master writes 412 on this
  // GET-then-PATCH. Upgrade: persist series etag on listed instances.
  const masterVersion = master.etag ?? "";
  if (!orig || !mStart) {
    return calFromPatch(
      calendarId,
      eventId,
      gBody(w, "update", timeZone),
      timeZone,
      expectedVersion,
      eventId,
    );
  }
  const head = isSeriesHead(orig.ms, mStart.ms);
  if (scope === "all" || head) {
    const shifted = writeForMaster(master, instance, w, timeZone);
    const body = gBody(shifted, "update", timeZone);
    if (master.recurrence?.length) {
      body.recurrence = shiftRecurrenceStart(
        master.recurrence,
        shifted.startMs,
        timeZone,
      );
    }
    return calFromPatch(
      calendarId,
      masterId,
      body,
      timeZone,
      masterVersion,
      eventId,
    );
  }
  // ponytail: no RRULE to split; later exceptions are not copied onto the new series.
  if (!master.recurrence?.length) {
    return calFromPatch(
      calendarId,
      eventId,
      gBody(w, "update", timeZone),
      timeZone,
      expectedVersion,
      eventId,
    );
  }
  return updateFollowing(
    calendarId,
    master,
    orig,
    w,
    timeZone,
    masterVersion,
    eventId,
  );
}

export async function deleteEvent(
  calendarId: string,
  eventId: string,
  scope: SeriesScope = "this",
  timeZone: string,
  expectedVersion: string,
): Promise<void> {
  const del = async (id: string, version: string) => {
    const res = await gfetch(eventsUrl(calendarId, id), {
      method: "DELETE",
      headers: { "If-Match": version },
    });
    await rejectIfStale(res, calendarId, eventId, timeZone);
    if (!res.ok && res.status !== 204 && res.status !== 410)
      throw new Error(`delete ${res.status}`);
  };
  if (scope === "this") {
    await del(eventId, expectedVersion);
    return;
  }
  const instance = await getGEvent(calendarId, eventId);
  if ((instance.etag ?? "") !== expectedVersion) {
    throw new EventConflictError(toCalEvent(instance, timeZone));
  }
  const masterId = instance.recurringEventId;
  if (!masterId) {
    await del(eventId, expectedVersion);
    return;
  }
  const master = await getGEvent(calendarId, masterId);
  const orig = parseGDate(
    instance.originalStartTime ?? instance.start,
    timeZone,
  );
  const mStart = parseGDate(master.start, timeZone);
  const head = orig && mStart ? isSeriesHead(orig.ms, mStart.ms) : false;
  const masterVersion = master.etag ?? "";
  if (scope === "all" || head || !orig || !master.recurrence?.length) {
    await del(masterId, masterVersion);
    return;
  }
  const until = untilStamp({
    originalStartMs: orig.ms,
    allDay: orig.allDay,
    timeZone,
  });
  await patchGEvent(
    calendarId,
    masterId,
    {
      recurrence: truncateRecurrence(
        master.recurrence,
        until,
        orig.ms,
        timeZone,
      ),
    },
    masterVersion,
    eventId,
    timeZone,
  );
}
