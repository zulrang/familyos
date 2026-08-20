import { handlePair } from "@/lib/pairing-http";

export async function POST(request: Request) {
  return handlePair(request);
}
