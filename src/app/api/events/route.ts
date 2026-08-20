import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isMemberTone } from "@/lib/calendar";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { AuthError, insertEvent, listEvents } from "@/lib/google";
import { readHousehold } from "@/lib/settings";

export async function GET(request: NextRequest) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const s = await readHousehold();
  if (!s.calendarId)
    return NextResponse.json({ error: "no calendar" }, { status: 400 });
  if (!from || !to)
    return NextResponse.json(
      { error: "from and to required" },
      { status: 400 },
    );
  try {
    const events = await listEvents(s.calendarId, from, to);
    return NextResponse.json({ events });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const s = await readHousehold();
  if (!s.calendarId)
    return NextResponse.json({ error: "no calendar" }, { status: 400 });
  const body = (await request.json()) as {
    title: string;
    allDay: boolean;
    startMs: number;
    endMs: number;
    tones?: string[];
    attendeeEmails?: string[];
  };
  try {
    const event = await insertEvent(s.calendarId, {
      title: body.title,
      allDay: body.allDay,
      startMs: body.startMs,
      endMs: body.endMs,
      tones: (body.tones ?? []).filter(isMemberTone),
      attendeeEmails: body.attendeeEmails ?? [],
    });
    return NextResponse.json({ event });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
