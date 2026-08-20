import { handleDeleteItem, handlePatchItem } from "@/lists/lists-http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
) {
  const { listId, itemId } = await params;
  return handlePatchItem(request, listId, itemId);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
) {
  const { listId, itemId } = await params;
  return handleDeleteItem(request, listId, itemId);
}
