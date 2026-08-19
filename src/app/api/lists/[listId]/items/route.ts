import { NextResponse } from "next/server";
import { insertTask, listsError } from "@/lib/tasks";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title)
    return NextResponse.json({ error: "title required" }, { status: 400 });
  try {
    const item = await insertTask(listId, title);
    return NextResponse.json({ item });
  } catch (e) {
    return listsError(e);
  }
}
