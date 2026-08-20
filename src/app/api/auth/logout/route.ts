import { NextResponse } from "next/server";
import { isUnauthorized, requireTrustedDisplay } from "@/lib/display-auth";
import { clearProviderConnection } from "@/lib/provider";

export async function POST(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  await clearProviderConnection();
  return NextResponse.json({ ok: true });
}
