import { handlePostTaskEvents } from "@/tasks/tasks-http";

export async function POST(request: Request) {
  return handlePostTaskEvents(request);
}
