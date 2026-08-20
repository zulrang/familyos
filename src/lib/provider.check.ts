/**
 * Provider Connection identity seam (#5).
 * Injected account ids — no live Google credentials.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-provider-"));
process.env.FAMILYOS_DATA_DIR = dataRoot;

const {
  clearProviderConnection,
  establishProviderConnection,
  readProvider,
  writeProvider,
} = await import("./provider.ts");
const { readHousehold, writeHousehold } = await import("./settings.ts");

await mkdir(dataRoot, { recursive: true });
await writeHousehold({
  familyName: "ProviderHousehold",
  members: [],
  calendarId: null,
  calendarTimeZone: null,
  listIds: [],
  configVersion: 1,
});

const tokensA = {
  access_token: "access-a",
  refresh_token: "refresh-a",
  expiry: Date.now() + 60_000,
};
const tokensB = {
  access_token: "access-b",
  refresh_token: "refresh-b",
  expiry: Date.now() + 60_000,
};

// --- Distinct Google accounts get distinct connection identities ---
{
  const a = await establishProviderConnection("google-sub-a", tokensA);
  assert.equal(a.providerConnectionId, "google-sub-a");
  assert.equal(a.tokens?.access_token, "access-a");
  assert.equal(a.oauthState, null);

  const b = await establishProviderConnection("google-sub-b", tokensB);
  assert.equal(b.providerConnectionId, "google-sub-b");
  assert.equal((await readProvider()).providerConnectionId, "google-sub-b");
  assert.notEqual(a.providerConnectionId, b.providerConnectionId);
}

// --- Reconnecting the same account restores the same identity ---
{
  await clearProviderConnection();
  assert.equal((await readProvider()).providerConnectionId, null);
  assert.equal((await readProvider()).tokens, null);

  const again = await establishProviderConnection("google-sub-a", tokensA);
  assert.equal(again.providerConnectionId, "google-sub-a");
}

// --- Establishing a connection does not bump Household Configuration ---
{
  const before = await readHousehold();
  await establishProviderConnection("google-sub-c", tokensB);
  const after = await readHousehold();
  assert.equal(after.configVersion, before.configVersion);
  assert.deepEqual(after, before);
}

// --- writeProvider round-trip keeps identity server-local ---
{
  await writeProvider({
    tokens: tokensA,
    oauthState: "pending",
    providerConnectionId: "google-sub-a",
  });
  const cur = await readProvider();
  assert.equal(cur.oauthState, "pending");
  assert.equal(cur.providerConnectionId, "google-sub-a");
}

// --- Logout / clear strips legacy kiosk.json credentials ---
{
  const legacyPath = path.join(dataRoot, "kiosk.json");
  await writeFile(
    legacyPath,
    `${JSON.stringify(
      {
        familyName: "Legacy",
        members: [],
        calendarId: null,
        calendarTimeZone: null,
        tokens: {
          access_token: "legacy-access",
          refresh_token: "legacy-refresh",
          expiry: Date.now() + 60_000,
        },
        oauthState: "legacy-state",
      },
      null,
      2,
    )}\n`,
  );
  await clearProviderConnection();
  const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as {
    tokens?: unknown;
    oauthState?: unknown;
    familyName?: string;
  };
  assert.equal("tokens" in legacy, false);
  assert.equal("oauthState" in legacy, false);
  assert.equal(legacy.familyName, "Legacy");
  assert.equal((await readProvider()).tokens, null);
}

// --- Migrating from legacy copies once then scrubs the old secrets ---
{
  await rm(path.join(dataRoot, "provider.json"), { force: true });
  const legacyPath = path.join(dataRoot, "kiosk.json");
  await writeFile(
    legacyPath,
    `${JSON.stringify(
      {
        familyName: "Legacy",
        tokens: {
          access_token: "migrated-access",
          refresh_token: "migrated-refresh",
          expiry: Date.now() + 60_000,
        },
        oauthState: null,
      },
      null,
      2,
    )}\n`,
  );
  const migrated = await readProvider();
  assert.equal(migrated.tokens?.access_token, "migrated-access");
  const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as {
    tokens?: unknown;
  };
  assert.equal("tokens" in legacy, false);

  await rm(path.join(dataRoot, "provider.json"), { force: true });
  const again = await readProvider();
  assert.equal(again.tokens, null);
}

await rm(dataRoot, { recursive: true, force: true });
console.log("provider.check ok");
