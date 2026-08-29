import {
  handleCreateTask,
  handleGetTasks,
  handleSaveTask,
} from "@/tasks/tasks-http";

export async function GET(request: Request) {
  return handleGetTasks(request);
}

export async function POST(request: Request) {
  return handleCreateTask(request);
}

export async function PUT(request: Request) {
  return handleSaveTask(request);
}
