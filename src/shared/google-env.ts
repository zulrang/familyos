export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function googleClient(): { id: string; secret: string } {
  return {
    id: process.env.GOOGLE_CLIENT_ID ?? "",
    secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  };
}

/** Host the browser used, not Next's bind address (often localhost). */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host");
  if (!host) return url.origin;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function googleRedirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/auth/callback/google`;
}
