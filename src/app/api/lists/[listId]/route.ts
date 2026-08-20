import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { deleteTaskList, listsError, patchTaskList } from "@/lib/tasks";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const { listId } = await params;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title)
    return NextResponse.json({ error: "title required" }, { status: 400 });
  try {
    const list = await patchTaskList(listId, title);
    return NextResponse.json({ list });
  } catch (e) {
    return listsError(e);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const { listId } = await params;
  try {
    await deleteTaskList(listId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return listsError(e);
  }
}
