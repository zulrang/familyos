import { NextResponse } from "next/server";
import { AuthError, listCalendars } from "@/lib/google";

export async function GET() {
  try {
    const calendars = await listCalendars();
    return NextResponse.json({ calendars });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
