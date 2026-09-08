import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";

const execFileAsync = promisify(execFile);

function macosServerPath(): string {
  // ponytail: FAMILYOS_MACOS_SERVER is the test seam (stub writes a receipt).
  // Ceiling: production is always scripts/macos-server; no second kicker.
  return (
    process.env.FAMILYOS_MACOS_SERVER ??
    path.join(process.cwd(), "scripts/macos-server")
  );
}

export async function handleKickUpdate(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  try {
    await execFileAsync(macosServerPath(), ["kick-update"], {
      timeout: 15_000,
    });
  } catch {
    return Response.json({ error: "Could not start update." }, { status: 500 });
  }
  return Response.json({ ok: true }, { status: 202 });
}
