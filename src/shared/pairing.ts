import { createHash, randomBytes, randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseUiScale, type UiScale } from "@/shared/ui-scale";
import { dataDir } from "./data-path";

export const DISPLAY_COOKIE = "fos_display";
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export type TrustedDisplay = {
  id: string;
  createdAt: number;
  revokedAt: number | null;
  uiScale: UiScale;
};

/** Public list row — scale is per-session, not shared roster data. */
export type DisplaySummary = {
  id: string;
  createdAt: number;
  revokedAt: number | null;
};

type StoredDisplay = {
  id: string;
  createdAt: number;
  revokedAt: number | null;
  credentialHash: string;
  uiScale: UiScale;
};

type PendingCode = {
  code: string;
  expiresAt: number;
  consumedAt: number | null;
};

type PairingStore = {
  pendingCode: PendingCode | null;
  displays: StoredDisplay[];
};

function storePath(): string {
  return path.join(dataDir(), "displays.json");
}

function normalizeDisplay(
  row: Partial<StoredDisplay> & { id: string },
): StoredDisplay {
  return {
    id: row.id,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    revokedAt: row.revokedAt ?? null,
    credentialHash:
      typeof row.credentialHash === "string" ? row.credentialHash : "",
    uiScale: parseUiScale(row.uiScale),
  };
}

function isDisplayRow(
  d: unknown,
): d is Partial<StoredDisplay> & { id: string } {
  return Boolean(
    d &&
      typeof d === "object" &&
      typeof (d as { id?: unknown }).id === "string",
  );
}

async function readStore(): Promise<PairingStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PairingStore>;
    const rows = Array.isArray(parsed.displays) ? parsed.displays : [];
    return {
      pendingCode: parsed.pendingCode ?? null,
      displays: rows.filter(isDisplayRow).map(normalizeDisplay),
    };
  } catch {
    return { pendingCode: null, displays: [] };
  }
}

// ponytail: last-write-wins JSON; upgrade to a write queue if concurrent pair races show up.
async function writeStore(store: PairingStore): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeFile(storePath(), `${JSON.stringify(store, null, 2)}\n`);
}

function hashCredential(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function newDisplayId(): string {
  return `d_${randomBytes(8).toString("hex")}`;
}

function newCredentialToken(displayId: string): string {
  return `${displayId}.${randomBytes(24).toString("hex")}`;
}

export function parseDisplayCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === DISPLAY_COOKIE) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

export async function resolveTrustedDisplay(
  cookieHeader: string | null,
): Promise<TrustedDisplay | null> {
  const token = parseDisplayCookie(cookieHeader);
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const store = await readStore();
  const row = store.displays.find((d) => d.id === id);
  if (!row || row.revokedAt != null) return null;
  if (row.credentialHash !== hashCredential(token)) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    uiScale: row.uiScale,
  };
}

/** Public Display records — never include credential material. */
export async function listTrustedDisplays(): Promise<DisplaySummary[]> {
  const store = await readStore();
  return store.displays
    .filter((d) => d.revokedAt == null)
    .map(({ id, createdAt, revokedAt }) => ({ id, createdAt, revokedAt }));
}

export async function setDisplayUiScale(
  displayId: string,
  uiScale: UiScale,
): Promise<boolean> {
  const store = await readStore();
  const row = store.displays.find((d) => d.id === displayId);
  if (!row || row.revokedAt != null) return false;
  row.uiScale = uiScale;
  await writeStore(store);
  return true;
}

/** Emit one short-lived pairing code when no Trusted Display exists yet. */
export async function emitStartupPairingCode(
  now = Date.now(),
): Promise<string | null> {
  const store = await readStore();
  const hasTrusted = store.displays.some((d) => d.revokedAt == null);
  if (hasTrusted) return null;
  return mintPendingCode(store, now);
}

/** Any Trusted Display may mint a short-lived code to pair another Display. */
export async function createPairingCode(
  now = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  const store = await readStore();
  const code = await mintPendingCode(store, now);
  return { code, expiresAt: now + PAIRING_CODE_TTL_MS };
}

async function mintPendingCode(
  store: PairingStore,
  now: number,
): Promise<string> {
  const code = newCode();
  store.pendingCode = {
    code,
    expiresAt: now + PAIRING_CODE_TTL_MS,
    consumedAt: null,
  };
  await writeStore(store);
  console.log(
    `FamilyOS pairing code: ${code} (expires in ${PAIRING_CODE_TTL_MS / 60000} minutes)`,
  );
  return code;
}

export type PairResult =
  | { ok: true; token: string; display: TrustedDisplay }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "reused" };

export async function pairWithCode(
  code: string,
  now = Date.now(),
): Promise<PairResult> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { ok: false, reason: "missing" };

  const store = await readStore();
  const pending = store.pendingCode;
  if (!pending || pending.code !== trimmed) {
    return { ok: false, reason: "invalid" };
  }
  if (pending.consumedAt != null) {
    return { ok: false, reason: "reused" };
  }
  if (pending.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }

  const id = newDisplayId();
  const token = newCredentialToken(id);
  const display: StoredDisplay = {
    id,
    credentialHash: hashCredential(token),
    createdAt: now,
    revokedAt: null,
    uiScale: 1,
  };
  pending.consumedAt = now;
  store.pendingCode = pending;
  store.displays.push(display);
  await writeStore(store);

  return {
    ok: true,
    token,
    display: {
      id,
      createdAt: display.createdAt,
      revokedAt: null,
      uiScale: display.uiScale,
    },
  };
}

export type RevokeResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "already_revoked" };

export async function revokeDisplay(
  displayId: string,
  now = Date.now(),
): Promise<RevokeResult> {
  const store = await readStore();
  const row = store.displays.find((d) => d.id === displayId);
  if (!row) return { ok: false, reason: "missing" };
  if (row.revokedAt != null) return { ok: false, reason: "already_revoked" };
  row.revokedAt = now;
  await writeStore(store);
  return { ok: true };
}
