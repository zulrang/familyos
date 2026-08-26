import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { authUrl } from "@/shared/google";
import { googleConfigured, googleRedirectUri } from "@/shared/google-env";
import { patchProvider } from "@/shared/provider";

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
  await patchProvider({ oauthState: state });
  return NextResponse.redirect(authUrl(state, googleRedirectUri(request)));
}
