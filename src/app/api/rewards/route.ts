import { handleRewards } from "@/rewards/http";
import { tasksDatabase } from "@/tasks/store";
export const runtime = "nodejs";
export function GET(request: Request) {
  return handleRewards(request, tasksDatabase);
}
export function POST(request: Request) {
  return handleRewards(request, tasksDatabase);
}
