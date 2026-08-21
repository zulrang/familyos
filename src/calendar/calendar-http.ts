import { presentationTonesFor } from "@/calendar/calendar";
import {
  deleteEvent,
  insertEvent,
  listEvents,
  updateEvent,
} from "@/calendar/google-events";
import { normalizeParticipantIds } from "@/calendar/participants";
import { parseScope } from "@/calendar/recurrence";
import { readHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { AuthError } from "@/shared/google";

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
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
  const s = await readHousehold();
  const body = (await request.json()) as {
    title: string;
    allDay: boolean;
    startMs: number;
    endMs: number;
    participantIds?: string[];
  };
  const participantIds = normalizeParticipantIds(body.participantIds ?? []);
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
  const s = await readHousehold();
  const body = (await request.json()) as {
    title: string;
    allDay: boolean;
    startMs: number;
    endMs: number;
    participantIds?: string[];
    scope?: string;
  };
  const participantIds = normalizeParticipantIds(body.participantIds ?? []);
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
      parseScope(body.scope),
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
