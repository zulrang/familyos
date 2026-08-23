import { presentationTonesFor } from "@/calendar/calendar";
import {
  deleteEvent,
  type EventWrite,
  insertEvent,
  listEvents,
  updateEvent,
} from "@/calendar/google-events";
import { normalizeParticipantIds } from "@/calendar/participants";
import { parseScope } from "@/calendar/recurrence";
import type { SeriesScope } from "@/calendar/types";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { AuthError } from "@/shared/google";

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

function catchAuth(e: unknown): Response {
  if (e instanceof AuthError) return jsonError("unauthorized", 401);
  return jsonError("failed", 500);
}

export async function handleListEvents(request: Request): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return jsonError("from and to required", 400);
  try {
    const events = await listEvents(gate.calendarId, from, to, gate.timeZone);
    return Response.json({ events });
  } catch (e) {
    return catchAuth(e);
  }
}

export async function handleCreateEvent(request: Request): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const body = parseEventWrite(await readJson(request));
  if (!body) return jsonError("invalid body", 400);
  const s = await readHousehold();
  const participantIds = normalizeParticipantIds(body.participantIds);
  try {
    const event = await insertEvent(
      gate.calendarId,
      {
        title: body.title,
        allDay: body.allDay,
        startMs: body.startMs,
        endMs: body.endMs,
        participantIds,
        presentationTones: presentationTonesFor(s.members, participantIds),
      },
      gate.timeZone,
    );
    return Response.json({ event });
  } catch (e) {
    return catchAuth(e);
  }
}

export async function handleUpdateEvent(
  request: Request,
  id: string,
): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const body = parseEventUpdate(await readJson(request));
  if (!body) return jsonError("invalid body", 400);
  const s = await readHousehold();
  const participantIds = normalizeParticipantIds(body.participantIds);
  try {
    const event = await updateEvent(
      gate.calendarId,
      id,
      {
        title: body.title,
        allDay: body.allDay,
        startMs: body.startMs,
        endMs: body.endMs,
        participantIds,
        presentationTones: presentationTonesFor(s.members, participantIds),
      },
      body.scope,
      gate.timeZone,
    );
    return Response.json({ event });
  } catch (e) {
    if (e instanceof AuthError) return jsonError("unauthorized", 401);
    console.error(e);
    return jsonError("failed", 500);
  }
}

export async function handleDeleteEvent(
  request: Request,
  id: string,
): Promise<Response> {
  const gate = await requireHouseholdCalendar(request);
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  try {
    await deleteEvent(
      gate.calendarId,
      id,
      parseScope(url.searchParams.get("scope")),
      gate.timeZone,
    );
    return Response.json({ ok: true });
  } catch (e) {
    return catchAuth(e);
  }
}
