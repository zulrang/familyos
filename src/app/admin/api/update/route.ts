import {
  handleAdminUpdate,
  handleAdminUpdateCheck,
} from "@/settings/update-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAdminUpdateCheck(request);
}

export async function POST(request: Request) {
  return handleAdminUpdate(request);
}
