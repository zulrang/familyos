import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { exchangeCode } from "@/shared/google";
import { googleRedirectUri, publicOrigin } from "@/shared/google-env";
import { readProvider } from "@/shared/provider";

function verifyOAuthState(
  url: URL,
  expectedState: string | null,
): string | null {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== expectedState) return null;
  return code;
}

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const provider = await readProvider();
  // CSRF relies on oauthState being minted only by a Trusted Display at /api/auth/google.
  const code = verifyOAuthState(request.nextUrl, provider.oauthState);
  if (!code) {
    return NextResponse.redirect(new URL("/settings", origin));
  }
  try {
    await exchangeCode(code, googleRedirectUri(request));
  } catch {
    return NextResponse.redirect(new URL("/settings", origin));
  }
  return NextResponse.redirect(new URL("/settings", origin));
}
