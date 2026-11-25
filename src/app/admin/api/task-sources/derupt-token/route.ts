import { handleAdminDeruptToken } from "@/external-task-sources/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  return handleAdminDeruptToken(request);
}
export async function DELETE(request: Request) {
  return handleAdminDeruptToken(request);
}
