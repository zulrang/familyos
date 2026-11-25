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

type Entry = { status: SourceStatus; configKey: string };

export type PollerLoop = Readonly<{ wake: () => void; stop: () => void }>;

type Registry = {
  started: boolean;
  loop: PollerLoop | null;
  statuses: Map<ExternalTaskSourceId, Entry>;
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
  global[REGISTRY_KEY] ??= {
    started: false,
    loop: null,
    statuses: new Map(),
  };
  return global[REGISTRY_KEY];
}

export function claimPollerStart(): boolean {
  const current = registry();
  if (current.started) return false;
  current.started = true;
  return true;
}

export function registerPollerLoop(loop: PollerLoop): void {
  registry().loop = loop;
}

export function wakeExternalTaskSources(): void {
  registry().loop?.wake();
}

export function sourceStatus(id: ExternalTaskSourceId): SourceStatus | null {
  return registry().statuses.get(id)?.status ?? null;
}

export function sourceStatusFor(
  id: ExternalTaskSourceId,
  configKey: string,
): SourceStatus | null {
  const entry = registry().statuses.get(id);
  return entry?.configKey === configKey ? entry.status : null;
}

export function setSourceStatus(
  id: ExternalTaskSourceId,
  status: SourceStatus,
  configKey: string,
): void {
  registry().statuses.set(id, { status, configKey });
}

function updateSourceStatus(id: ExternalTaskSourceId, status: SourceStatus) {
  const entry = registry().statuses.get(id);
  if (entry) entry.status = status;
}

export function resetExternalTaskSourcesForTests(): void {
  const current = registry();
  current.loop?.stop();
  current.loop = null;
  current.started = false;
  current.statuses.clear();
}

export function recordSuccess(id: ExternalTaskSourceId, at: Date): void {
  const status = sourceStatus(id);
  if (status?.state !== "enabled") return;
  updateSourceStatus(id, { ...status, lastSuccessAt: at.toISOString() });
}

export function recordProblem(
  id: ExternalTaskSourceId,
  code: string,
  at: Date,
): void {
  const status = sourceStatus(id);
  if (status?.state !== "enabled") return;
  updateSourceStatus(id, {
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
  updateSourceStatus(id, {
    state: "halted",
    reason,
    at: at.toISOString(),
    lastSuccessAt: status.lastSuccessAt,
    lastProblem: status.lastProblem,
  });
}
