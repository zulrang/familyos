import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { authUrl } from "@/lib/google";
import { googleConfigured, patchSettings } from "@/lib/settings";

export async function GET(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google is not configured" },
      { status: 500 },
    );
  }
  const state = randomBytes(16).toString("hex");
  await patchSettings({ oauthState: state });
  return NextResponse.redirect(authUrl(state));
}
