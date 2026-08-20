import { AuthError } from "./auth-error.ts";

export function listsError(e: unknown): Response {
  if (e instanceof AuthError)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  console.error(e);
  return Response.json({ error: "failed" }, { status: 500 });
}
