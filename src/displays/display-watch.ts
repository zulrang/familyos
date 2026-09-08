export type ReadySnapshot = {
  paired: boolean;
  buildId: string | null;
};

export type DisplayWatchAction =
  | { kind: "none"; buildId: string | null }
  | { kind: "pairing" }
  | { kind: "reload" };

export function parseReadySnapshot(raw: unknown): ReadySnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!("paired" in raw) || typeof raw.paired !== "boolean") return null;
  const buildId =
    "buildId" in raw && typeof raw.buildId === "string" && raw.buildId
      ? raw.buildId
      : null;
  return { paired: raw.paired, buildId };
}

export function displayWatchAction(
  knownBuildId: string | null,
  ready: ReadySnapshot,
): DisplayWatchAction {
  if (!ready.paired) return { kind: "pairing" };
  if (
    knownBuildId != null &&
    ready.buildId != null &&
    ready.buildId !== knownBuildId
  ) {
    return { kind: "reload" };
  }
  return { kind: "none", buildId: ready.buildId ?? knownBuildId };
}
