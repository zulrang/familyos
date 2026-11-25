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
    const connection = value as PhotosConnection;
    // Selections saved before pickingEndsAt existed have already timed out.
    if (
      connection.state === "selecting" &&
      typeof connection.pickingEndsAt !== "number"
    )
      return { ...connection, pickingEndsAt: 0 };
    return connection;
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

export function withPhotosConnectionWriteLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withFileQueue(file(), operation);
}
