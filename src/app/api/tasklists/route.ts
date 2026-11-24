import { NextResponse } from "next/server";
import { listTaskLists } from "@/lists/tasks";
import { ProviderAuthError } from "@/shared/auth-error";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";

export async function GET(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  try {
    const tasklists = await listTaskLists();
    return NextResponse.json({ tasklists });
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    console.error("tasklists:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
