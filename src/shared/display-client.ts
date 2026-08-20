/** Client: pairing-gate 401 vs Google AuthError 401. */
export async function redirectIfPairingRequired(
  res: Response,
): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: string } | null;
  if (body?.error !== "pairing required") return false;
  window.location.assign("/");
  return true;
}
