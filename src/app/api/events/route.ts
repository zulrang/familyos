import { handleCreateEvent, handleListEvents } from "@/calendar/calendar-http";

export async function GET(request: Request) {
  return handleListEvents(request);
}

export async function POST(request: Request) {
  return handleCreateEvent(request);
}
