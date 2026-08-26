import type { CalEvent } from "@/calendar/types";
import { AuthError } from "@/shared/auth-error";

/** Google Calendar is unreachable or disconnected. */
export class ProviderUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("unavailable", options);
  }
}

export function rethrowAsUnavailable(e: unknown): never {
  if (e instanceof AuthError) throw e;
  if (e instanceof EventConflictError) throw e;
  const cause = e instanceof Error ? e : new Error(String(e));
  console.error("calendar unavailable:", cause);
  throw new ProviderUnavailableError({ cause });
}

/** Stale Calendar write: provider state moved past the expected version. */
export class EventConflictError extends Error {
  readonly event: CalEvent | null;
  constructor(event: CalEvent | null) {
    super("version");
    this.event = event;
  }
}

export function calendarError(e: unknown): Response {
  if (e instanceof AuthError)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (e instanceof ProviderUnavailableError)
    return Response.json({ error: "read-only" }, { status: 503 });
  if (e instanceof EventConflictError)
    return Response.json({ error: "version", event: e.event }, { status: 409 });
  console.error(e);
  return Response.json({ error: "failed" }, { status: 500 });
}
