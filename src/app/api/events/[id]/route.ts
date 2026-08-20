import { handleDeleteEvent, handleUpdateEvent } from "@/calendar/calendar-http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleUpdateEvent(request, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleDeleteEvent(request, id);
}
