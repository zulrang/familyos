import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/shared/data-path";
import { withFileQueue, writeAtomicJson } from "@/shared/json-file";

/**
 * The Derupt connection token a parent saved in admin. It is a password: the
 * file is owner-only and the value never leaves the server.
 */
function tokenFile(): string {
  return path.join(dataDir(), "derupt-token.json");
}

/** The saved token, or null when none is saved or the file is unreadable. */
export function readSavedDeruptToken(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(tokenFile(), "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "token" in parsed &&
      typeof parsed.token === "string" &&
      parsed.token.trim()
    )
      return parsed.token.trim();
  } catch {
    /* no saved token */
  }
  return null;
}

export function saveDeruptToken(token: string): Promise<void> {
  const file = tokenFile();
  return withFileQueue(file, () =>
    writeAtomicJson(file, { token }, { mode: 0o600 }),
  );
}

export function clearDeruptToken(): Promise<void> {
  const file = tokenFile();
  return withFileQueue(file, async () => {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  });
}
