import { legacyTonesForParticipants } from "@/calendar/calendar";
import type { EventWrite } from "@/calendar/google-events";
import { normalizeParticipantIds } from "@/calendar/participants";
import { parseScope } from "@/calendar/recurrence";
import type { CalEvent, CalendarRead, SeriesScope } from "@/calendar/types";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { ProviderAuthError } from "@/shared/google";
import { readProvider } from "@/shared/provider";
import {
  getCalendarEventsCache,
  listCalendarCacheRanges,
  pruneCalendarCache,
  putCalendarEventsCache,
} from "./calendar-cache";
import { calendarError, ProviderUnavailableError } from "./calendar-error";
import {
  type CalendarGateway,
  googleCalendarGateway,
} from "./calendar-gateway";

export type { CalendarGateway };

function resolveGateway(gateway?: CalendarGateway): CalendarGateway {
  return gateway ?? googleCalendarGateway();
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

function parseExpectedVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).expectedVersion;
  return typeof v === "string" && v ? v : null;
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
  return calendarError(new ProviderAuthError());
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

type CacheRefreshTarget =
  | { kind: "create"; event: CalEvent }
  | { kind: "update"; eventId: string; event: CalEvent; scope: SeriesScope }
  | { kind: "delete"; eventId: string; scope: SeriesScope };

function rangeOverlapsEvent(
  range: { from: string; to: string },
  event: Pick<CalEvent, "startMs" | "endMs">,
): boolean {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return true;
  if (event.endMs <= event.startMs) {
    return event.startMs >= fromMs && event.startMs < toMs;
  }
  return fromMs < event.endMs && toMs > event.startMs;
}

async function cachedRangeContainsEvent(
  connectionId: string,
  calendarId: string,
  range: { from: string; to: string },
  eventId: string,
): Promise<boolean> {
  const cached = await getCalendarEventsCache(
    connectionId,
    calendarId,
    range.from,
    range.to,
  );
  if (!cached) return true;
  return cached.some((e) => e.id === eventId);
}

async function shouldRefreshRange(
  connectionId: string,
  calendarId: string,
  range: { from: string; to: string },
  target: CacheRefreshTarget,
): Promise<boolean> {
  switch (target.kind) {
    case "create":
      return rangeOverlapsEvent(range, target.event);
    case "update":
      if (target.scope !== "this") return true;
      if (rangeOverlapsEvent(range, target.event)) return true;
      return cachedRangeContainsEvent(
        connectionId,
        calendarId,
        range,
        target.eventId,
      );
    case "delete":
      if (target.scope !== "this") return true;
      return cachedRangeContainsEvent(
        connectionId,
        calendarId,
        range,
        target.eventId,
      );
  }
}

async function bestEffortRefreshNamespaceCache(
  gw: CalendarGateway,
  calendarId: string,
  timeZone: string,
  target: CacheRefreshTarget,
): Promise<void> {
  const { providerConnectionId } = await readProvider();
  if (!providerConnectionId) return;
  try {
    await pruneCalendarCache(providerConnectionId, calendarId);
    const ranges = await listCalendarCacheRanges(
      providerConnectionId,
      calendarId,
    );
    const flags = await Promise.all(
      ranges.map((range) =>
        shouldRefreshRange(providerConnectionId, calendarId, range, target),
      ),
    );
    const affected = ranges.filter((_, i) => flags[i]);
    await Promise.allSettled(
      affected.map(async (range) => {
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
      }),
    );
  } catch {}
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
  } catch {}
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
    if (!provider.tokens?.access_token) throw new ProviderAuthError();
    const gw = await resolveGateway(gateway);
    events = await gw.listEvents(gate.calendarId, from, to, gate.timeZone);
  } catch (e) {
    if (e instanceof ProviderAuthError) return calendarError(e);
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
    await bestEffortRefreshNamespaceCache(gw, gate.calendarId, gate.timeZone, {
      kind: "create",
      event,
    });
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
  const raw = await readJson(request);
  const body = parseEventUpdate(raw);
  if (!body) return jsonError("invalid body", 400);
  const expectedVersion = parseExpectedVersion(raw);
  if (!expectedVersion) return jsonError("expectedVersion required", 400);
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
      expectedVersion,
    );
    await bestEffortRefreshNamespaceCache(gw, gate.calendarId, gate.timeZone, {
      kind: "update",
      eventId: id,
      event,
      scope: body.scope,
    });
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
  const scope = parseScope(url.searchParams.get("scope"));
  const expectedVersion = parseExpectedVersion(await readJson(request));
  if (!expectedVersion) return jsonError("expectedVersion required", 400);
  try {
    const gw = await resolveGateway(gateway);
    await gw.deleteEvent(
      gate.calendarId,
      id,
      scope,
      gate.timeZone,
      expectedVersion,
    );
    await bestEffortRefreshNamespaceCache(gw, gate.calendarId, gate.timeZone, {
      kind: "delete",
      eventId: id,
      scope,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return calendarError(e);
  }
}
