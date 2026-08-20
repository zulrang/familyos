import { displayCredentialCookie } from "./display-auth.ts";
import { pairWithCode, resolveTrustedDisplay } from "./pairing.ts";

export async function handleReady(request: Request): Promise<Response> {
  const display = await resolveTrustedDisplay(request.headers.get("cookie"));
  return Response.json({
    ready: true,
    paired: Boolean(display),
  });
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
