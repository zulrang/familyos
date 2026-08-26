import { NextResponse } from "next/server";
import { listCalendars } from "@/calendar/google-events";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { AuthError } from "@/shared/google";

export async function GET(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  try {
    const calendars = await listCalendars();
    return NextResponse.json({ calendars });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    console.error("calendars:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
