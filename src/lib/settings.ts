import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-path.ts";
import type { Member } from "./types.ts";

export type Tokens = {
  access_token: string;
  refresh_token: string;
  expiry: number;
};

export type StoredSettings = {
  familyName: string;
  members: Member[];
  calendarId: string | null;
  calendarTimeZone: string | null;
  tokens: Tokens | null;
  oauthState: string | null;
};

function settingsFile(): string {
  return path.join(dataDir(), "kiosk.json");
}

const EMPTY: StoredSettings = {
  familyName: "Family",
  members: [],
  calendarId: null,
  calendarTimeZone: null,
  tokens: null,
  oauthState: null,
};

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function googleClient(): {
  id: string;
  secret: string;
  redirect: string;
} {
  const id = process.env.GOOGLE_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirect =
    process.env.GOOGLE_REDIRECT_URI ??
    "http://localhost:3000/api/auth/callback/google";
  return { id, secret, redirect };
}

export async function readSettings(): Promise<StoredSettings> {
  try {
    const raw = await readFile(settingsFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredSettings> & {
      uiScale?: unknown;
    };
    // Drop legacy household-wide uiScale; scale lives on each Display (#4).
    const { uiScale: _legacy, ...rest } = parsed;
    return { ...EMPTY, ...rest };
  } catch {
    return { ...EMPTY };
  }
}

// ponytail: last-write-wins JSON file; upgrade to a write queue if OAuth refresh races show up.
export async function writeSettings(next: StoredSettings): Promise<void> {
  const file = settingsFile();
  await mkdir(path.dirname(file), { recursive: true });
  // ponytail: strip legacy uiScale if callers still pass it; delete once data dirs are clean.
  const { uiScale: _legacy, ...clean } = next as StoredSettings & {
    uiScale?: unknown;
  };
  await writeFile(file, `${JSON.stringify(clean, null, 2)}\n`);
}

export async function patchSettings(
  patch: Partial<StoredSettings>,
): Promise<StoredSettings> {
  const cur = await readSettings();
  const next = { ...cur, ...patch };
  await writeSettings(next);
  return next;
}
