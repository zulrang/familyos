import { handleCreatePairingCode } from "@/displays/displays-http";

export async function POST(request: Request) {
  return handleCreatePairingCode(request);
}
