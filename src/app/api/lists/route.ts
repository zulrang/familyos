import { NextResponse } from "next/server";
import { insertTaskList, listListsWithItems, listsError } from "@/lib/tasks";

export async function GET() {
  try {
    const lists = await listListsWithItems();
    return NextResponse.json({ lists });
  } catch (e) {
    return listsError(e);
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title)
    return NextResponse.json({ error: "title required" }, { status: 400 });
  try {
    const list = await insertTaskList(title);
    return NextResponse.json({ list });
  } catch (e) {
    return listsError(e);
  }
}
