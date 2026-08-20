import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { patchSettings } from "@/lib/settings";

export async function POST(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  await patchSettings({ tokens: null, oauthState: null });
  return NextResponse.json({ ok: true });
}
