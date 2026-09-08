import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/shared/data-path";
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
  await mkdir(dataDir(), { recursive: true });
  const temp = `${file()}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(connection)}\n`, { mode: 0o600 });
  await rename(temp, file());
}

// One server process serves all Displays. Serialize OAuth polls, refreshes and
// disconnects so an in-flight request cannot restore a disconnected account.
const queues = new Map<string, Promise<unknown>>();
export async function withPhotosConnection<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const key = file();
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
