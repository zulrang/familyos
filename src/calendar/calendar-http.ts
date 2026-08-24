import { legacyTonesForParticipants } from "@/calendar/calendar";
import type { EventWrite } from "@/calendar/google-events";
import { normalizeParticipantIds } from "@/calendar/participants";
import { parseScope } from "@/calendar/recurrence";
import type { CalendarRead, SeriesScope } from "@/calendar/types";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { AuthError } from "@/shared/google";
import { readProvider } from "@/shared/provider";
import {
  getCalendarEventsCache,
  listCalendarCacheRanges,
  putCalendarEventsCache,
} from "./calendar-cache";
import { calendarError, ProviderUnavailableError } from "./calendar-error";
import type { CalendarGateway } from "./calendar-gateway";

export type { CalendarGateway };

// ponytail: lazy default so tests can inject a Fake without loading Google.
async function defaultGateway(): Promise<CalendarGateway> {
  const { googleCalendarGateway } = await import("./calendar-gateway.ts");
  return googleCalendarGateway();
}

async function resolveGateway(
  gateway?: CalendarGateway,
): Promise<CalendarGateway> {
  return gateway ?? (await defaultGateway());
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function parseEventWrite(raw: unknown): EventWrite | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.title !== "string") return null;
  if (typeof o.allDay !== "boolean") return null;
  if (typeof o.startMs !== "number" || !Number.isFinite(o.startMs)) return null;
  if (typeof o.endMs !== "number" || !Number.isFinite(o.endMs)) return null;
  let participantIds: string[] = [];
  if (o.participantIds !== undefined) {
    if (
      !Array.isArray(o.participantIds) ||
      o.participantIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }
    participantIds = o.participantIds;
  }
  return {
    title: o.title,
    allDay: o.allDay,
    startMs: o.startMs,
    endMs: o.endMs,
    participantIds,
  };
}

function parseEventUpdate(
  raw: unknown,
): (EventWrite & { scope: SeriesScope }) | null {
  const body = parseEventWrite(raw);
  if (!body) return null;
  const o = raw as Record<string, unknown>;
  return { ...body, scope: parseScope(o.scope) };
}

async function requireHouseholdCalendar(
  request: Request,
): Promise<{ calendarId: string; timeZone: string } | Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const s = await readHousehold();
  if (!s.calendarId) return jsonError("no calendar", 400);
  return { calendarId: s.calendarId, timeZone: s.timeZone };
}

async function rejectIfReadOnly(calendarId: string): Promise<Response | null> {
  const provider = await readProvider();
  if (provider.tokens?.access_token) return null;
  const ranges = provider.providerConnectionId
    ? await listCalendarCacheRanges(provider.providerConnectionId, calendarId)
    : [];
  if (ranges.length) return calendarError(new ProviderUnavailableError());
  return calendarError(new AuthError());
}

async function cachedEvents(
  connectionId: string | null,
  calendarId: string,
  from: string,
  to: string,
): Promise<CalendarRead["events"] | null> {
  if (!connectionId) return null;
  return getCalendarEventsCache(connectionId, calendarId, from, to);
}

async function bestEffortRefreshNamespaceCache(
  gw: CalendarGateway,
  calendarId: string,
  timeZone: string,
): Promise<void> {
  const { providerConnectionId } = await readProvider();
  if (!providerConnectionId) return;
  try {
    const ranges = await listCalendarCacheRanges(
      providerConnectionId,
      calendarId,
    );
    for (const range of ranges) {
      const events = await gw.listEvents(
        calendarId,
        range.from,
        range.to,
        timeZone,
      );
      await putCalendarEventsCache(
        providerConnectionId,
        calendarId,
        range.from,
        range.to,
        events,
      );
    }
  } catch {
    /* live write already succeeded */
  }
}

async function bestEffortRefreshEventsCache(
  connectionId: string | null,
  calendarId: string,
  from: string,
  to: string,
  events: CalendarRead["events"],
): Promise<void> {
  if (!connectionId) return;
  try {
    await putCalendarEventsCache(connectionId, calendarId, from, to, events);
  } catch {
    /* live events already in hand */
  }
}

export async function handleListEvents(
  request: Request,
  gateway?: CalendarGateway,
): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return jsonError("from and to required", 400);
  const provider = await readProvider();
  let events: CalendarRead["events"];
  try {
    if (!provider.tokens?.access_token) throw new AuthError();
    const gw = await resolveGateway(gateway);
    events = await gw.listEvents(gate.calendarId, from, to, gate.timeZone);
  } catch (e) {
    const cached = await cachedEvents(
      provider.providerConnectionId,
      gate.calendarId,
      from,
      to,
    );
    if (cached) {
      return Response.json({
        events: cached,
        stale: true,
      } satisfies CalendarRead);
    }
    return calendarError(e);
  }
  await bestEffortRefreshEventsCache(
    provider.providerConnectionId,
    gate.calendarId,
    from,
    to,
    events,
  );
  return Response.json({ events, stale: false } satisfies CalendarRead);
}

export async function handleCreateEvent(
  request: Request,
  gateway?: CalendarGateway,
): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const deniedWrite = await rejectIfReadOnly(gate.calendarId);
  if (deniedWrite) return deniedWrite;
  const body = parseEventWrite(await readJson(request));
  if (!body) return jsonError("invalid body", 400);
  const s = await readHousehold();
  const participantIds = normalizeParticipantIds(body.participantIds);
  try {
    const gw = await resolveGateway(gateway);
    const event = await gw.insertEvent(
      gate.calendarId,
      {
        title: body.title,
        allDay: body.allDay,
        startMs: body.startMs,
        endMs: body.endMs,
        participantIds,
        legacyTones: legacyTonesForParticipants(s.members, participantIds),
      },
      gate.timeZone,
    );
    await bestEffortRefreshNamespaceCache(gw, gate.calendarId, gate.timeZone);
    return Response.json({ event });
  } catch (e) {
    return calendarError(e);
  }
}

export async function handleUpdateEvent(
  request: Request,
  id: string,
  gateway?: CalendarGateway,
): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const deniedWrite = await rejectIfReadOnly(gate.calendarId);
  if (deniedWrite) return deniedWrite;
  const body = parseEventUpdate(await readJson(request));
  if (!body) return jsonError("invalid body", 400);
  const s = await readHousehold();
  const participantIds = normalizeParticipantIds(body.participantIds);
  try {
    const gw = await resolveGateway(gateway);
    const event = await gw.updateEvent(
      gate.calendarId,
      id,
      {
        title: body.title,
        allDay: body.allDay,
        startMs: body.startMs,
        endMs: body.endMs,
        participantIds,
        legacyTones: legacyTonesForParticipants(s.members, participantIds),
      },
      body.scope,
      gate.timeZone,
    );
    await bestEffortRefreshNamespaceCache(gw, gate.calendarId, gate.timeZone);
    return Response.json({ event });
  } catch (e) {
    return calendarError(e);
  }
}

export async function handleDeleteEvent(
  request: Request,
  id: string,
  gateway?: CalendarGateway,
): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const deniedWrite = await rejectIfReadOnly(gate.calendarId);
  if (deniedWrite) return deniedWrite;
  const url = new URL(request.url);
  try {
    const gw = await resolveGateway(gateway);
    await gw.deleteEvent(
      gate.calendarId,
      id,
      parseScope(url.searchParams.get("scope")),
      gate.timeZone,
    );
    await bestEffortRefreshNamespaceCache(gw, gate.calendarId, gate.timeZone);
    return Response.json({ ok: true });
  } catch (e) {
    return calendarError(e);
  }
}
