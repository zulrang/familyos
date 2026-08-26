import type { ListItem } from "@/lists/types";
import { AuthError } from "@/shared/auth-error";

/** Google Tasks is unreachable or disconnected. */
export class ProviderUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("unavailable", options);
  }
}

export function rethrowAsUnavailable(e: unknown): never {
  if (e instanceof AuthError) throw e;
  if (e instanceof ListItemConflictError) throw e;
  const cause = e instanceof Error ? e : new Error(String(e));
  console.error("lists unavailable:", cause);
  throw new ProviderUnavailableError({ cause });
}

/** Stale List Item write: provider state moved past the expected version. */
export class ListItemConflictError extends Error {
  readonly item: ListItem | null;
  constructor(item: ListItem | null) {
    super("version");
    this.item = item;
  }
}

export function listsError(e: unknown): Response {
  if (e instanceof AuthError)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (e instanceof ProviderUnavailableError)
    return Response.json({ error: "read-only" }, { status: 503 });
  if (e instanceof ListItemConflictError)
    return Response.json({ error: "version", item: e.item }, { status: 409 });
  console.error(e);
  return Response.json({ error: "failed" }, { status: 500 });
}
