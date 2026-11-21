import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-path";
import { withFileQueue, writeAtomicJson } from "./json-file";

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

export type RefreshTarget = {
  providerConnectionId: string | null;
  refreshToken: string;
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
    await writeAtomicJson(legacyFile(), rest, { pretty: true });
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

async function readProviderFileUnlocked(): Promise<ProviderConnection> {
  const raw = await readFile(providerFile(), "utf8");
  return normalize(JSON.parse(raw) as Partial<ProviderConnection>);
}

async function readProviderUnlocked(): Promise<ProviderConnection> {
  try {
    return await readProviderFileUnlocked();
  } catch {
    return { ...EMPTY };
  }
}

async function writeProviderUnlocked(next: ProviderConnection): Promise<void> {
  await writeAtomicJson(providerFile(), next, { mode: 0o600, pretty: true });
}

async function migrateOrEmptyUnlocked(): Promise<ProviderConnection> {
  try {
    return await readProviderFileUnlocked();
  } catch {
    const legacy = await migrateFromLegacy();
    if (legacy) {
      // Persist first, then scrub — same order as establish/clear so a failed
      // write still leaves credentials recoverable from kiosk.json.
      await writeProviderUnlocked(legacy);
      await scrubLegacyCredentials();
      return legacy;
    }
    return { ...EMPTY };
  }
}

export async function readProvider(): Promise<ProviderConnection> {
  try {
    return await readProviderFileUnlocked();
  } catch {
    return withFileQueue(providerFile(), migrateOrEmptyUnlocked);
  }
}

export async function writeProvider(next: ProviderConnection): Promise<void> {
  return withFileQueue(providerFile(), () => writeProviderUnlocked(next));
}

export async function patchProvider(
  patch: Partial<ProviderConnection>,
): Promise<ProviderConnection> {
  return withFileQueue(providerFile(), async () => {
    const cur = await migrateOrEmptyUnlocked();
    const next = { ...cur, ...patch };
    await writeProviderUnlocked(next);
    return next;
  });
}

/** Bind tokens to a Google account identity (userinfo `sub`). */
export async function establishProviderConnection(
  accountId: string,
  tokens: Tokens,
): Promise<ProviderConnection> {
  return withFileQueue(providerFile(), async () => {
    const next: ProviderConnection = {
      tokens,
      oauthState: null,
      providerConnectionId: accountId,
    };
    await writeProviderUnlocked(next);
    await scrubLegacyCredentials();
    return next;
  });
}

async function clearProviderUnlocked(
  cur: ProviderConnection,
): Promise<ProviderConnection> {
  const next: ProviderConnection = {
    tokens: null,
    oauthState: null,
    providerConnectionId: cur.providerConnectionId,
  };
  await writeProviderUnlocked(next);
  await scrubLegacyCredentials();
  return next;
}

export async function clearProviderConnection(): Promise<ProviderConnection> {
  return withFileQueue(providerFile(), async () => {
    const cur = await migrateOrEmptyUnlocked();
    return clearProviderUnlocked(cur);
  });
}

function matchesRefreshTarget(
  cur: ProviderConnection,
  expected: RefreshTarget,
): boolean {
  return (
    cur.tokens !== null &&
    cur.providerConnectionId === expected.providerConnectionId &&
    cur.tokens.refresh_token === expected.refreshToken
  );
}

/**
 * Commit refreshed tokens only if the provider connection and refresh token
 * still match the session that initiated the refresh (e.g., no concurrent logout
 * or account switch).
 */
export async function commitRefreshedTokens(
  expected: RefreshTarget,
  next: Tokens,
): Promise<boolean> {
  return withFileQueue(providerFile(), async () => {
    const cur = await readProviderUnlocked();
    if (!matchesRefreshTarget(cur, expected)) return false;
    await writeProviderUnlocked({ ...cur, tokens: next });
    return true;
  });
}

/**
 * Clear tokens after `invalid_grant` only if the connection and refresh token
 * still match the refresh that failed.
 */
export async function clearProviderConnectionIfMatching(
  expected: RefreshTarget,
): Promise<boolean> {
  return withFileQueue(providerFile(), async () => {
    const cur = await readProviderUnlocked();
    if (!matchesRefreshTarget(cur, expected)) return false;
    await clearProviderUnlocked(cur);
    return true;
  });
}
