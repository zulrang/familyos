export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { emitStartupPairingCode } = await import("@/shared/pairing");
  await emitStartupPairingCode();
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    // Polls in the background; disabled without FAMILYOS_DERUPT_TOKEN.
    const { startExternalTaskSources } = await import(
      "@/external-task-sources/poller"
    );
    startExternalTaskSources();
  } catch (error) {
    console.error("External task sources did not start", error);
  }
}
