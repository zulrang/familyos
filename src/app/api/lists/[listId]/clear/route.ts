import { NextResponse } from "next/server";
import { clearCompleted, listsError } from "@/lib/tasks";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  try {
    await clearCompleted(listId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return listsError(e);
  }
}
