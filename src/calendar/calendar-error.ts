import { AuthError } from "@/shared/auth-error";

/** Google Calendar is unreachable or disconnected. */
export class ProviderUnavailableError extends Error {
  constructor() {
    super("unavailable");
  }
}

export function calendarError(e: unknown): Response {
  if (e instanceof AuthError)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (e instanceof ProviderUnavailableError)
    return Response.json({ error: "read-only" }, { status: 503 });
  console.error(e);
  return Response.json({ error: "failed" }, { status: 500 });
}
