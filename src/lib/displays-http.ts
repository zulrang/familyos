import { isUnauthorized, requireTrustedDisplay } from "./display-auth.ts";
import {
  createPairingCode,
  listTrustedDisplays,
  revokeDisplay,
} from "./pairing.ts";

export async function handleListDisplays(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const displays = await listTrustedDisplays();
  return Response.json({
    displays,
    currentDisplayId: display.id,
  });
}

export async function handleCreatePairingCode(
  request: Request,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const pending = await createPairingCode();
  return Response.json(pending);
}

export async function handleRevokeDisplay(
  request: Request,
  displayId: string,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const result = await revokeDisplay(displayId);
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 404 });
  }
  return Response.json({ ok: true });
}
