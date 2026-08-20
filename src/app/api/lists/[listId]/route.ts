import { handleRenameList, handleUnselectList } from "@/lib/lists-http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  return handleRenameList(request, listId);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  return handleUnselectList(request, listId);
}
