export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { emitStartupPairingCode } = await import("@/shared/pairing");
  await emitStartupPairingCode();
}
