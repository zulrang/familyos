import { NextResponse } from "next/server";
import { deleteTask, listsError, patchTask } from "@/lib/tasks";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
) {
  const { listId, itemId } = await params;
  const body = (await request.json()) as { title?: string; done?: boolean };
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  if (title === undefined && typeof body.done !== "boolean") {
    return NextResponse.json({ error: "nothing to patch" }, { status: 400 });
  }
  if (title !== undefined && !title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  try {
    const item = await patchTask(listId, itemId, {
      title,
      done: body.done,
    });
    return NextResponse.json({ item });
  } catch (e) {
    return listsError(e);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
) {
  const { listId, itemId } = await params;
  try {
    await deleteTask(listId, itemId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return listsError(e);
  }
}
