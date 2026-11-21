import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/shared/data-path";
import { withFileQueue, writeAtomicJson } from "@/shared/json-file";
import type { PhotosConnection } from "./photos";

function file() {
  return path.join(dataDir(), "photos.json");
}

export async function readPhotosConnection(): Promise<PhotosConnection> {
  try {
    const value: unknown = JSON.parse(await readFile(file(), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { state: "disconnected" };
    const state = (value as { state?: unknown }).state;
    if (state !== "disconnected" && state !== "selecting" && state !== "ready")
      return { state: "disconnected" };
    return value as PhotosConnection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { state: "disconnected" };
    throw error;
  }
}

export async function writePhotosConnection(
  connection: PhotosConnection,
): Promise<void> {
  await writeAtomicJson(file(), connection, { mode: 0o600 });
}

// One server process serves all Displays. Serialize OAuth polls, refreshes and
// disconnects so an in-flight request cannot restore a disconnected account.
export function withPhotosConnection<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withFileQueue(file(), operation);
}
