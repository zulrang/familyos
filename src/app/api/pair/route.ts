import { handlePair } from "@/displays/pairing-http";

export async function POST(request: Request) {
  return handlePair(request);
}
