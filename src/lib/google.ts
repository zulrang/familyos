import {
  colorIdForTones,
  googleDateTime,
  isMemberTone,
  TONES_PROP,
  tonesFromGoogle,
} from "./calendar";
import {
  followingRecurrence,
  isSeriesHead,
  rruleCount,
  shiftRecurrenceStart,
  truncateRecurrence,
  untilStamp,
} from "./recurrence";
import {
  googleClient,
  patchSettings,
  readSettings,
  type Tokens,
} from "./settings";
import type {
  CalEvent,
  GoogleCalendar,
  MemberTone,
  SeriesScope,
} from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

export function authUrl(state: string): string {
  const { id, redirect } = googleClient();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}`);
  return res.json();
}

export async function exchangeCode(code: string): Promise<void> {
  const { id, secret, redirect } = googleClient();
  const cur = await readSettings();
  const tok = await tokenRequest({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  await patchSettings({
    oauthState: null,
    tokens: {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? cur.tokens?.refresh_token ?? "",
      expiry: Date.now() + tok.expires_in * 1000,
    },
  });
}

async function accessToken(): Promise<string> {
  const s = await readSettings();
  if (!s.tokens?.access_token) throw new AuthError();
  if (s.tokens.expiry - 60_000 > Date.now()) return s.tokens.access_token;
  if (!s.tokens.refresh_token) throw new AuthError();
  const { id, secret } = googleClient();
  const tok = await tokenRequest({
    refresh_token: s.tokens.refresh_token,
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
  });
  const next: Tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? s.tokens.refresh_token,
    expiry: Date.now() + tok.expires_in * 1000,
  };
  await patchSettings({ tokens: next });
  return next.access_token;
}

export class AuthError extends Error {
  constructor() {
    super("not signed in");
  }
}

async function gfetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) throw new AuthError();
  return res;
}

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

function parseGDate(d?: GDate): { ms: number; allDay: boolean } | null {
  if (!d) return null;
  if (d.dateTime) return { ms: new Date(d.dateTime).getTime(), allDay: false };
  if (d.date) {
    const [y, m, day] = d.date.split("-").map(Number);
    return { ms: new Date(y, m - 1, day).getTime(), allDay: true };
  }
  return null;
}

function toCalEvent(g: GEvent): CalEvent | null {
  if (!g.id) return null;
  const start = parseGDate(g.start);
  const end = parseGDate(g.end);
  if (!start || !end) return null;
  const emails = (g.attendees ?? []).map((a) => a.email ?? "").filter(Boolean);
  const stored = g.extendedProperties?.private?.[TONES_PROP];
  const original = parseGDate(g.originalStartTime);
  return {
    id: g.id,
    title: g.summary || "Busy",
    allDay: start.allDay,
    startMs: start.ms,
    endMs: end.ms,
    tones: tonesFromGoogle({
      colorId: g.colorId,
      stored: stored === undefined || stored === null ? undefined : stored,
    }),
    attendeeEmails: [...new Set(emails.map((e) => e.toLowerCase()))],
    recurringEventId: g.recurringEventId,
    originalStartMs: original?.ms,
  };
}

export async function listEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string,
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
      const ev = toCalEvent(item);
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
  tones: MemberTone[];
  attendeeEmails: string[];
};

function eventTimeZone(g: GEvent): string {
  return (
    g.start?.timeZone ||
    g.end?.timeZone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

function gBody(
  w: EventWrite,
  mode: "insert" | "update",
  timeZone?: string,
): Record<string, unknown> {
  const tones = [...new Set(w.tones.filter(isMemberTone))];
  const attendees = w.attendeeEmails.map((email) => ({ email }));
  let start: GDate;
  let end: GDate;
  if (w.allDay) {
    const s = new Date(w.startMs);
    const e = new Date(w.endMs);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    start = { date: fmt(s) };
    end = { date: fmt(e) };
  } else {
    start = googleDateTime(w.startMs, timeZone);
    end = googleDateTime(w.endMs, timeZone);
  }
  const body: Record<string, unknown> = {
    summary: w.title,
    start,
    end,
    attendees,
  };
  const colorId = colorIdForTones(tones);
  if (colorId) body.colorId = colorId;
  else if (mode === "update") body.colorId = null;
  // ponytail: Google 400s on null private props ("Required"); "" clears a prior multi list.
  if (tones.length > 1) {
    body.extendedProperties = { private: { [TONES_PROP]: tones.join(",") } };
  } else if (mode === "update") {
    body.extendedProperties = { private: { [TONES_PROP]: "" } };
  }
  return body;
}

export async function insertEvent(
  calendarId: string,
  w: EventWrite,
): Promise<CalEvent> {
  const res = await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    { method: "POST", body: JSON.stringify(gBody(w, "insert")) },
  );
  if (!res.ok) {
    throw new Error(`insert ${res.status} ${await res.text()}`);
  }
  const ev = toCalEvent((await res.json()) as GEvent);
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

async function patchGEvent(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<GEvent> {
  const res = await gfetch(
    `${eventsUrl(calendarId, eventId)}?sendUpdates=none`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`update ${res.status} ${await res.text()}`);
  return res.json() as Promise<GEvent>;
}

async function calFromPatch(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<CalEvent> {
  const ev = toCalEvent(await patchGEvent(calendarId, eventId, body));
  if (!ev) throw new Error("update returned no event");
  return ev;
}

function writeForMaster(
  master: GEvent,
  instance: GEvent,
  w: EventWrite,
): EventWrite {
  const orig = parseGDate(instance.originalStartTime ?? instance.start);
  const mStart = parseGDate(master.start);
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
      const s = parseGDate(item.originalStartTime ?? item.start);
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
): Promise<CalEvent> {
  const masterId = master.id;
  if (!masterId) throw new Error("master has no id");
  const recurrence = master.recurrence ?? [];
  const until = untilStamp({
    originalStartMs: orig.ms,
    allDay: orig.allDay,
  });
  const oldRec = truncateRecurrence(recurrence, until, orig.ms);
  const count = rruleCount(recurrence);
  const remaining =
    count == null
      ? null
      : Math.max(
          1,
          count - (await countInstancesBefore(calendarId, masterId, orig.ms)),
        );
  const newRec = shiftRecurrenceStart(
    followingRecurrence(recurrence, orig.ms, remaining),
    w.startMs,
  );
  const insertBody: Record<string, unknown> = {
    ...gBody(w, "insert", orig.allDay ? undefined : eventTimeZone(master)),
    recurrence: newRec,
  };
  if (master.description) insertBody.description = master.description;
  if (master.location) insertBody.location = master.location;
  if (master.reminders) insertBody.reminders = master.reminders;
  await patchGEvent(calendarId, masterId, { recurrence: oldRec });
  try {
    const res = await gfetch(`${eventsUrl(calendarId)}?sendUpdates=none`, {
      method: "POST",
      body: JSON.stringify(insertBody),
    });
    if (!res.ok) throw new Error(`insert ${res.status} ${await res.text()}`);
    const ev = toCalEvent((await res.json()) as GEvent);
    if (!ev) throw new Error("insert returned no event");
    return ev;
  } catch (e) {
    await patchGEvent(calendarId, masterId, { recurrence });
    throw e;
  }
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  w: EventWrite,
  scope: SeriesScope = "this",
): Promise<CalEvent> {
  if (scope === "this") {
    return calFromPatch(calendarId, eventId, gBody(w, "update"));
  }
  const instance = await getGEvent(calendarId, eventId);
  const masterId = instance.recurringEventId;
  if (!masterId) {
    return calFromPatch(calendarId, eventId, gBody(w, "update"));
  }
  const master = await getGEvent(calendarId, masterId);
  const orig = parseGDate(instance.originalStartTime ?? instance.start);
  const mStart = parseGDate(master.start);
  if (!orig || !mStart) {
    return calFromPatch(calendarId, eventId, gBody(w, "update"));
  }
  const head = isSeriesHead(orig.ms, mStart.ms);
  if (scope === "all" || head) {
    const shifted = writeForMaster(master, instance, w);
    const body = gBody(
      shifted,
      "update",
      shifted.allDay ? undefined : eventTimeZone(master),
    );
    if (master.recurrence?.length) {
      body.recurrence = shiftRecurrenceStart(
        master.recurrence,
        shifted.startMs,
      );
    }
    return calFromPatch(calendarId, masterId, body);
  }
  // ponytail: no RRULE to split; later exceptions are not copied onto the new series.
  if (!master.recurrence?.length) {
    return calFromPatch(calendarId, eventId, gBody(w, "update"));
  }
  return updateFollowing(calendarId, master, orig, w);
}

export async function deleteEvent(
  calendarId: string,
  eventId: string,
  scope: SeriesScope = "this",
): Promise<void> {
  const del = async (id: string) => {
    const res = await gfetch(eventsUrl(calendarId, id), { method: "DELETE" });
    if (!res.ok && res.status !== 204 && res.status !== 410)
      throw new Error(`delete ${res.status}`);
  };
  if (scope === "this") {
    await del(eventId);
    return;
  }
  const instance = await getGEvent(calendarId, eventId);
  const masterId = instance.recurringEventId;
  if (!masterId) {
    await del(eventId);
    return;
  }
  const master = await getGEvent(calendarId, masterId);
  const orig = parseGDate(instance.originalStartTime ?? instance.start);
  const mStart = parseGDate(master.start);
  const head = orig && mStart ? isSeriesHead(orig.ms, mStart.ms) : false;
  if (scope === "all" || head || !orig || !master.recurrence?.length) {
    await del(masterId);
    return;
  }
  const until = untilStamp({
    originalStartMs: orig.ms,
    allDay: orig.allDay,
  });
  await patchGEvent(calendarId, masterId, {
    recurrence: truncateRecurrence(master.recurrence, until, orig.ms),
  });
}
