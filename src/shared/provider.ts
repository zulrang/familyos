import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-path";

export type Tokens = {
  access_token: string;
  refresh_token: string;
  expiry: number;
};

/** Server-local Provider Connection — credentials + identity for cache isolation. */
export type ProviderConnection = {
  tokens: Tokens | null;
  oauthState: string | null;
  providerConnectionId: string | null;
};

const EMPTY: ProviderConnection = {
  tokens: null,
  oauthState: null,
  providerConnectionId: null,
};

function providerFile(): string {
  return path.join(dataDir(), "provider.json");
}

function legacyFile(): string {
  return path.join(dataDir(), "kiosk.json");
}

function normalize(raw: Partial<ProviderConnection>): ProviderConnection {
  return {
    tokens: raw.tokens ?? null,
    oauthState: raw.oauthState ?? null,
    providerConnectionId:
      typeof raw.providerConnectionId === "string"
        ? raw.providerConnectionId
        : null,
  };
}

/** Drop OAuth secrets from pre-split kiosk.json so logout/migrate cannot revive them. */
async function scrubLegacyCredentials(): Promise<void> {
  try {
    const raw = await readFile(legacyFile(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!("tokens" in parsed) && !("oauthState" in parsed)) return;
    const { tokens: _tokens, oauthState: _oauth, ...rest } = parsed;
    await writeFile(legacyFile(), `${JSON.stringify(rest, null, 2)}\n`);
  } catch {
    /* no legacy file */
  }
}

async function migrateFromLegacy(): Promise<ProviderConnection | null> {
  try {
    const raw = await readFile(legacyFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProviderConnection>;
    return normalize({
      tokens: parsed.tokens ?? null,
      oauthState: parsed.oauthState ?? null,
      providerConnectionId: null,
    });
  } catch {
    return null;
  }
}

export async function readProvider(): Promise<ProviderConnection> {
  try {
    const raw = await readFile(providerFile(), "utf8");
    return normalize(JSON.parse(raw) as Partial<ProviderConnection>);
  } catch {
    const legacy = await migrateFromLegacy();
    if (legacy) {
      // Persist first, then scrub — same order as establish/clear so a failed
      // write still leaves credentials recoverable from kiosk.json.
      await writeProvider(legacy);
      await scrubLegacyCredentials();
      return legacy;
    }
    return { ...EMPTY };
  }
}

// ponytail: last-write-wins JSON; upgrade to a write queue if OAuth refresh races show up.
export async function writeProvider(next: ProviderConnection): Promise<void> {
  const file = providerFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
}

export async function patchProvider(
  patch: Partial<ProviderConnection>,
): Promise<ProviderConnection> {
  const cur = await readProvider();
  const next = { ...cur, ...patch };
  await writeProvider(next);
  return next;
}

/** Bind tokens to a Google account identity (userinfo `sub`). */
export async function establishProviderConnection(
  accountId: string,
  tokens: Tokens,
): Promise<ProviderConnection> {
  const next: ProviderConnection = {
    tokens,
    oauthState: null,
    providerConnectionId: accountId,
  };
  await writeProvider(next);
  await scrubLegacyCredentials();
  return next;
}

export async function clearProviderConnection(): Promise<ProviderConnection> {
  const cur = await readProvider();
  const next: ProviderConnection = {
    tokens: null,
    oauthState: null,
    providerConnectionId: cur.providerConnectionId,
  };
  await writeProvider(next);
  await scrubLegacyCredentials();
  return next;
}
