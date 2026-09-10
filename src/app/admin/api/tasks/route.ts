import { handleAdminTasks } from "@/tasks/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAdminTasks(request);
}
export async function POST(request: Request) {
  return handleAdminTasks(request);
}
