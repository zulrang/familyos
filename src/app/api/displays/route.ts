import { handleListDisplays } from "@/displays/displays-http";

export async function GET(request: Request) {
  return handleListDisplays(request);
}
