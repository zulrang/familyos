import { handleRevokeDisplay } from "@/displays/displays-http";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleRevokeDisplay(request, id);
}
