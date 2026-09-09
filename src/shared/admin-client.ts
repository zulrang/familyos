"use client";

import { useCallback, useEffect, useState } from "react";

export type RemoteData<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

export async function adminRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/admin/api/${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-familyos-admin": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(
      "Cannot reach FamilyOS. Connect to home Wi-Fi and try again.",
    );
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "session")
      window.dispatchEvent(new Event("admin-session-expired"));
    throw new Error(result.error ?? "The request could not be saved.");
  }
  return result as T;
}

/** getRandomValues works on the household's HTTP origin; randomUUID requires HTTPS. */
export function adminRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function useAdminData<T>(read: () => Promise<T>) {
  const [state, setState] = useState<RemoteData<T>>({ status: "loading" });
  const reload = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", data: await read() });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : "Could not load data.",
      });
    }
  }, [read]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, reload };
}
