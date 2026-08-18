import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isMemberTone } from "@/lib/calendar";
import { AuthError, deleteEvent, updateEvent } from "@/lib/google";
import { parseScope } from "@/lib/recurrence";
import { readSettings } from "@/lib/settings";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const s = await readSettings();
  if (!s.calendarId)
    return NextResponse.json({ error: "no calendar" }, { status: 400 });
  const body = (await request.json()) as {
    title: string;
    allDay: boolean;
    startMs: number;
    endMs: number;
    tones?: string[];
    attendeeEmails?: string[];
    scope?: string;
  };
  try {
    const event = await updateEvent(
      s.calendarId,
      id,
      {
        title: body.title,
        allDay: body.allDay,
        startMs: body.startMs,
        endMs: body.endMs,
        tones: (body.tones ?? []).filter(isMemberTone),
        attendeeEmails: body.attendeeEmails ?? [],
      },
      parseScope(body.scope),
    );
    return NextResponse.json({ event });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const s = await readSettings();
  if (!s.calendarId)
    return NextResponse.json({ error: "no calendar" }, { status: 400 });
  try {
    await deleteEvent(
      s.calendarId,
      id,
      parseScope(request.nextUrl.searchParams.get("scope")),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
