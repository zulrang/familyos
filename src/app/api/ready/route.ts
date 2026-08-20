import { handleReady } from "@/lib/pairing-http";

export async function GET(request: Request) {
  return handleReady(request);
}
