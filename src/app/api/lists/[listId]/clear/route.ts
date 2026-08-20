import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { clearCompleted, listsError } from "@/lib/tasks";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const { listId } = await params;
  try {
    await clearCompleted(listId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return listsError(e);
  }
}
