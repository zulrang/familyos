import { handleAdminMembers } from "@/members/admin-http";
import { reconcileHouseholdTasks } from "@/tasks/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAdminMembers(request);
}
export async function POST(request: Request) {
  const response = await handleAdminMembers(request);
  if (response.ok) await reconcileHouseholdTasks();
  return response;
}
