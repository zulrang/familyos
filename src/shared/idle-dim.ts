export const IDLE_DIM_AFTER_MS = [
  30_000, 60_000, 120_000, 300_000, 600_000,
] as const;
export type IdleDimAfterMs = (typeof IDLE_DIM_AFTER_MS)[number];

export const IDLE_DIM_TO = [1, 10, 20, 30, 40, 50, 60, 70, 80] as const;
export type IdleDimTo = (typeof IDLE_DIM_TO)[number];

export const IDLE_DIM_DEFAULT_AFTER_MS: IdleDimAfterMs = 300_000;
export const IDLE_DIM_DEFAULT_TO: IdleDimTo = 10;

export const IDLE_DIM_APPLY_URL = "http://127.0.0.1:7380/idle-dim";

export type IdleDim = {
  idleDimAfterMs: IdleDimAfterMs;
  idleDimTo: IdleDimTo;
};

export function parseIdleDimAfterMs(
  value: unknown,
  fallback: IdleDimAfterMs = IDLE_DIM_DEFAULT_AFTER_MS,
): IdleDimAfterMs {
  return IDLE_DIM_AFTER_MS.includes(value as IdleDimAfterMs)
    ? (value as IdleDimAfterMs)
    : fallback;
}

export function parseIdleDimTo(
  value: unknown,
  fallback: IdleDimTo = IDLE_DIM_DEFAULT_TO,
): IdleDimTo {
  return IDLE_DIM_TO.includes(value as IdleDimTo)
    ? (value as IdleDimTo)
    : fallback;
}

export async function applyIdleDim(dim: IdleDim): Promise<void> {
  try {
    await fetch(IDLE_DIM_APPLY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dim),
      signal: AbortSignal.timeout(800),
    });
  } catch {
    /* best-effort; laptop and down listener are normal */
  }
}
