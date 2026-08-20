/**
 * Provider Connection identity seam (#5).
 * Injected account ids — no live Google credentials.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

await rm(dataRoot, { recursive: true, force: true });
console.log("provider.check ok");
