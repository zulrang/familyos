import { NextResponse } from "next/server";
import { listTaskLists } from "@/lists/tasks";
import { AuthError } from "@/shared/auth-error";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";

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
    console.error("tasklists:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
