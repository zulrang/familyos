import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth-error";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { listTaskLists } from "@/lib/tasks";

/** Provider tasklist catalog for Settings Household List selection. */
export async function GET(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  try {
    const tasklists = await listTaskLists();
    return NextResponse.json({ tasklists });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
