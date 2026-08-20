import { handleClearCompleted } from "@/lists/lists-http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  return handleClearCompleted(request, listId);
}
