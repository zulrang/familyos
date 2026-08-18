import { NextResponse } from "next/server";
import { patchSettings } from "@/lib/settings";

export async function POST() {
  await patchSettings({ tokens: null, oauthState: null });
  return NextResponse.json({ ok: true });
}
