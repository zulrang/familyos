export type SourceProblem = Readonly<{ code: string; at: string }>;

export type SourceStatus =
  | Readonly<{
      state: "disabled";
      reason: "not_configured" | "invalid_token" | "invalid_endpoint";
    }>
  | Readonly<{
      state: "enabled";
      lastSuccessAt: string | null;
      lastProblem: SourceProblem | null;
    }>
  | Readonly<{
      state: "halted";
      reason: "token_rejected" | "connection_revoked";
      at: string;
      lastSuccessAt: string | null;
      lastProblem: SourceProblem | null;
    }>;

export type ExternalTaskSourceId = "derupt";

type Registry = {
  started: boolean;
  statuses: Map<ExternalTaskSourceId, SourceStatus>;
};

/**
 * The status lives on `globalThis` because Next.js bundles instrumentation
 * (which runs the poller) separately from route handlers (which read the
 * status); module-level state would not be shared between them.
 */
const REGISTRY_KEY = "__familyosExternalTaskSources";

function registry(): Registry {
  const global = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: Registry;
  };
  global[REGISTRY_KEY] ??= { started: false, statuses: new Map() };
  return global[REGISTRY_KEY];
}

export function claimPollerStart(): boolean {
  const current = registry();
  if (current.started) return false;
  current.started = true;
  return true;
}

export function sourceStatus(id: ExternalTaskSourceId): SourceStatus | null {
  return registry().statuses.get(id) ?? null;
}

export function setSourceStatus(
  id: ExternalTaskSourceId,
  status: SourceStatus,
): void {
  registry().statuses.set(id, status);
}

export function resetExternalTaskSourcesForTests(): void {
  const current = registry();
  current.started = false;
  current.statuses.clear();
}

export function recordSuccess(id: ExternalTaskSourceId, at: Date): void {
  const status = sourceStatus(id);
  if (status?.state !== "enabled") return;
  setSourceStatus(id, { ...status, lastSuccessAt: at.toISOString() });
}

export function recordProblem(
  id: ExternalTaskSourceId,
  code: string,
  at: Date,
): void {
  const status = sourceStatus(id);
  if (status?.state !== "enabled") return;
  setSourceStatus(id, {
    ...status,
    lastProblem: { code, at: at.toISOString() },
  });
}

export function recordHalt(
  id: ExternalTaskSourceId,
  reason: "token_rejected" | "connection_revoked",
  at: Date,
): void {
  const status = sourceStatus(id);
  if (status?.state !== "enabled") return;
  setSourceStatus(id, {
    state: "halted",
    reason,
    at: at.toISOString(),
    lastSuccessAt: status.lastSuccessAt,
    lastProblem: status.lastProblem,
  });
}
