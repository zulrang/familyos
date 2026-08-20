import { handleCreatePairingCode } from "@/lib/displays-http";

export async function POST(request: Request) {
  return handleCreatePairingCode(request);
}
