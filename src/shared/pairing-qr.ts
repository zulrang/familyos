/** Short-lived pairing secret as a scannable URL — never credentials or household data. */

export function pairingUrl(origin: string, code: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("code", code);
  return url.href;
}

export function pairingCodeFromSearch(search: string): string | null {
  const code = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  )
    .get("code")
    ?.trim()
    .toUpperCase();
  return code || null;
}

export function formatStartupPairingAnnouncement(
  code: string,
  origin: string,
  ttlMinutes: number,
): string {
  return `FamilyOS pairing code: ${code} (expires in ${ttlMinutes} minutes)\n${pairingUrl(origin, code)}`;
}
