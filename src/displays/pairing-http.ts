import { readFileSync } from "node:fs";
import path from "node:path";
import { displayCredentialCookie } from "@/shared/display-auth";
import { pairWithCode, resolveTrustedDisplay } from "@/shared/pairing";

function householdBuildId(buildDir = process.cwd()): string | null {
  try {
    return (
      readFileSync(path.join(buildDir, ".next/BUILD_ID"), "utf8").trim() || null
    );
  } catch {
    return null;
  }
}

export async function handleReady(
  request: Request,
  options?: { buildDir?: string },
): Promise<Response> {
  const display = await resolveTrustedDisplay(request.headers.get("cookie"));
  return Response.json(
    {
      ready: true,
      paired: Boolean(display),
      buildId: householdBuildId(options?.buildDir),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function handlePair(request: Request): Promise<Response> {
  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code : "";
  const result = await pairWithCode(code);
  if (!result.ok) {
    const status = result.reason === "missing" ? 400 : 403;
    return Response.json({ error: result.reason }, { status });
  }
  return new Response(
    JSON.stringify({ ok: true, displayId: result.display.id }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": displayCredentialCookie(result.token),
      },
    },
  );
}
