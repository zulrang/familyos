import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { exchangeCode } from "@/lib/google";
import { readProvider } from "@/lib/provider";

export async function GET(request: NextRequest) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const provider = await readProvider();
  if (!code || !state || state !== provider.oauthState) {
    return NextResponse.redirect(new URL("/settings", url.origin));
  }
  try {
    await exchangeCode(code);
  } catch {
    return NextResponse.redirect(new URL("/settings", url.origin));
  }
  return NextResponse.redirect(new URL("/settings", url.origin));
}
