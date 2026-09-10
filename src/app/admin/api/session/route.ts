import { handleAdminSession } from "@/shared/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAdminSession(request);
}
export async function POST(request: Request) {
  return handleAdminSession(request);
}
export async function DELETE(request: Request) {
  return handleAdminSession(request);
}
