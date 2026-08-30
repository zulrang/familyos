import { handleKickUpdate } from "@/settings/update-http";

export async function POST(request: Request) {
  return handleKickUpdate(request);
}
