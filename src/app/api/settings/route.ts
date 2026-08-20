import { handleGetSettings, handlePatchSettings } from "@/lib/settings-http";

export async function GET(request: Request) {
  return handleGetSettings(request);
}

export async function PATCH(request: Request) {
  return handlePatchSettings(request);
}
