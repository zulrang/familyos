import { NextResponse } from "next/server";
import { listCalendars } from "@/lib/google";
import { googleConfigured, patchSettings, readSettings } from "@/lib/settings";
import type { Member } from "@/lib/types";

export async function GET() {
  const s = await readSettings();
  return NextResponse.json({
    familyName: s.familyName,
    members: s.members,
    calendarId: s.calendarId,
    signedIn: Boolean(s.tokens?.access_token),
    googleConfigured: googleConfigured(),
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    familyName?: string;
    members?: Member[];
    calendarId?: string | null;
  };
  const cur = await readSettings();
  let calendarTimeZone = cur.calendarTimeZone;
  const calendarId =
    body.calendarId === undefined ? cur.calendarId : body.calendarId;
  if (calendarId && calendarId !== cur.calendarId && cur.tokens) {
    try {
      const list = await listCalendars();
      calendarTimeZone =
        list.find((c) => c.id === calendarId)?.timeZone ?? calendarTimeZone;
    } catch {
      /* keep existing tz */
    }
  }
  const next = await patchSettings({
    familyName:
      typeof body.familyName === "string" ? body.familyName : cur.familyName,
    members: Array.isArray(body.members) ? body.members : cur.members,
    calendarId,
    calendarTimeZone,
  });
  return NextResponse.json({
    familyName: next.familyName,
    members: next.members,
    calendarId: next.calendarId,
    signedIn: Boolean(next.tokens?.access_token),
    googleConfigured: googleConfigured(),
  });
}
