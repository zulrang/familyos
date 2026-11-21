import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const queues = new Map<string, Promise<unknown>>();

/**
 * Serialize async read-modify-write operations on the same file path so
 * concurrent requests in one server process cannot clobber each other.
 */
export async function withFileQueue<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(filePath);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}

/**
 * Write JSON via a sibling temp file and atomic rename so readers never observe
 * a truncated file. Cleans up the temp file if writing or renaming fails.
 */
export async function writeAtomicJson(
  filePath: string,
  data: unknown,
  options?: { mode?: number; pretty?: boolean },
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${randomUUID()}.tmp`;
  const body = options?.pretty
    ? `${JSON.stringify(data, null, 2)}\n`
    : `${JSON.stringify(data)}\n`;
  try {
    await writeFile(
      temp,
      body,
      options?.mode !== undefined ? { mode: options.mode } : undefined,
    );
    await rename(temp, filePath);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
