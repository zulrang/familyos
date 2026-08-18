import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl } from "@/lib/google";
import { googleConfigured, patchSettings } from "@/lib/settings";

export async function GET() {
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
