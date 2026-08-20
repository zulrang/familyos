import { handleListDisplays } from "@/lib/displays-http";

export async function GET(request: Request) {
  return handleListDisplays(request);
}
