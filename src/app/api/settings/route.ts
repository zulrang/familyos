import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { listCalendars } from "@/lib/google";
import { googleConfigured, patchSettings, readSettings } from "@/lib/settings";
import { type Member, parseUiScale } from "@/lib/types";

function publicSettings(s: Awaited<ReturnType<typeof readSettings>>) {
  return {
    familyName: s.familyName,
    members: s.members,
    calendarId: s.calendarId,
    signedIn: Boolean(s.tokens?.access_token),
    googleConfigured: googleConfigured(),
    uiScale: s.uiScale,
  };
}

export async function GET(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  return NextResponse.json(publicSettings(await readSettings()));
}

export async function PATCH(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const body = (await request.json()) as {
    familyName?: string;
    members?: Member[];
    calendarId?: string | null;
    uiScale?: unknown;
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
    uiScale:
      body.uiScale === undefined
        ? cur.uiScale
        : parseUiScale(body.uiScale, cur.uiScale),
  });
  return NextResponse.json(publicSettings(next));
}
