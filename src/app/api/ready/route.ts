import { handleReady } from "@/displays/pairing-http";

export async function GET(request: Request) {
  return handleReady(request);
}
