import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type FileQueues = Map<string, Promise<unknown>>;

const FILE_QUEUES_KEY = Symbol.for("familyos.shared.fileQueues");

/**
 * Stored on `globalThis` because Next.js bundles `instrumentation.ts`
 * separately from route handlers; a module-scoped Map would not serialize
 * writes across bundles in the same Node process.
 */
function fileQueues(): FileQueues {
  const store = globalThis as typeof globalThis &
    Record<symbol, FileQueues | undefined>;
  const existing = store[FILE_QUEUES_KEY];
  if (existing) return existing;
  const created: FileQueues = new Map();
  store[FILE_QUEUES_KEY] = created;
  return created;
}

export async function withFileQueue<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const queues = fileQueues();
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
