import { handleAdminTaskSources } from "@/external-task-sources/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAdminTaskSources(request);
}
export async function POST(request: Request) {
  return handleAdminTaskSources(request);
}
