import { handleCreateTask, handleGetTasks } from "@/tasks/tasks-http";

export async function GET(request: Request) {
  return handleGetTasks(request);
}

export async function POST(request: Request) {
  return handleCreateTask(request);
}
