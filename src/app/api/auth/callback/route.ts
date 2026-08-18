import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google";
import { readSettings } from "@/lib/settings";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const s = await readSettings();
  if (!code || !state || state !== s.oauthState) {
    return NextResponse.redirect(new URL("/settings", url.origin));
  }
  try {
    await exchangeCode(code);
  } catch {
    return NextResponse.redirect(new URL("/settings", url.origin));
  }
  return NextResponse.redirect(new URL("/settings", url.origin));
}
