import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-path.ts";
import { type Member, parseUiScale, type UiScale } from "./types.ts";

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
  uiScale: UiScale;
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
  uiScale: 1,
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
    const next = { ...EMPTY, ...JSON.parse(raw) };
    next.uiScale = parseUiScale(next.uiScale);
    return next;
  } catch {
    return { ...EMPTY };
  }
}

// ponytail: last-write-wins JSON file; upgrade to a write queue if OAuth refresh races show up.
export async function writeSettings(next: StoredSettings): Promise<void> {
  const file = settingsFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
}

export async function patchSettings(
  patch: Partial<StoredSettings>,
): Promise<StoredSettings> {
  const cur = await readSettings();
  const next = { ...cur, ...patch };
  await writeSettings(next);
  return next;
}
