import {
  DISPLAY_COOKIE,
  resolveTrustedDisplay,
  type TrustedDisplay,
} from "./pairing.ts";

export function unauthorizedDisplay(): Response {
  return Response.json({ error: "pairing required" }, { status: 401 });
}

export async function requireTrustedDisplay(
  request: Request,
): Promise<TrustedDisplay | Response> {
  const display = await resolveTrustedDisplay(request.headers.get("cookie"));
  if (!display) return unauthorizedDisplay();
  return display;
}

export function displayCredentialCookie(token: string): string {
  // LAN kiosk is HTTP; Secure would drop the cookie on wall Chromium.
  return `${DISPLAY_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

export function isUnauthorized(
  value: TrustedDisplay | Response,
): value is Response {
  return value instanceof Response;
}
