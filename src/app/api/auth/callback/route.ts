import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { exchangeCode } from "@/shared/google";
import { googleRedirectUri, publicOrigin } from "@/shared/google-env";
import { readProvider } from "@/shared/provider";

export async function GET(request: NextRequest) {
  // Redirect URI follows this request's Host so a LAN Display does not
  // bounce through localhost (where the pairing cookie is missing).
  // CSRF is oauthState, minted only by a Trusted Display at /api/auth/google.
  const origin = publicOrigin(request);
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const provider = await readProvider();
  if (!code || !state || state !== provider.oauthState) {
    return NextResponse.redirect(new URL("/settings", origin));
  }
  try {
    await exchangeCode(code, googleRedirectUri(request));
  } catch {
    return NextResponse.redirect(new URL("/settings", origin));
  }
  return NextResponse.redirect(new URL("/settings", origin));
}
