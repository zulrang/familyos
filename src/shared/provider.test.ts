import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";

describe("Provider Connection", () => {
  let dataRoot: string;
  let clearProviderConnection: typeof import("@/shared/provider").clearProviderConnection;
  let clearProviderConnectionIfMatching: typeof import("@/shared/provider").clearProviderConnectionIfMatching;
  let commitRefreshedTokens: typeof import("@/shared/provider").commitRefreshedTokens;
  let establishProviderConnection: typeof import("@/shared/provider").establishProviderConnection;
  let readProvider: typeof import("@/shared/provider").readProvider;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  let readHousehold: typeof import("@/settings/settings").readHousehold;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;

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

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-provider-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      clearProviderConnection,
      clearProviderConnectionIfMatching,
      commitRefreshedTokens,
      establishProviderConnection,
      readProvider,
      writeProvider,
    } = await import("@/shared/provider"));
    ({ readHousehold, writeHousehold } = await import("@/settings/settings"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "ProviderHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 1,
    });
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test("distinct Google accounts get distinct connection identities", async () => {
    const a = await establishProviderConnection("google-sub-a", tokensA);
    assert.equal(a.providerConnectionId, "google-sub-a");
    assert.equal(a.tokens?.access_token, "access-a");
    assert.equal(a.oauthState, null);

    const b = await establishProviderConnection("google-sub-b", tokensB);
    assert.equal(b.providerConnectionId, "google-sub-b");
    assert.equal((await readProvider()).providerConnectionId, "google-sub-b");
    assert.notEqual(a.providerConnectionId, b.providerConnectionId);
  });

  test("reconnecting the same account restores the same identity", async () => {
    await clearProviderConnection();
    assert.equal((await readProvider()).providerConnectionId, "google-sub-b");
    assert.equal((await readProvider()).tokens, null);

    const again = await establishProviderConnection("google-sub-a", tokensA);
    assert.equal(again.providerConnectionId, "google-sub-a");
  });

  test("establishing a connection does not bump Household Configuration", async () => {
    const before = await readHousehold();
    await establishProviderConnection("google-sub-c", tokensB);
    const after = await readHousehold();
    assert.equal(after.configVersion, before.configVersion);
    assert.deepEqual(after, before);
  });

  test("persisted Provider Connection identity stays server-local", async () => {
    await writeProvider({
      tokens: tokensA,
      oauthState: "pending",
      providerConnectionId: "google-sub-a",
    });
    const cur = await readProvider();
    assert.equal(cur.oauthState, "pending");
    assert.equal(cur.providerConnectionId, "google-sub-a");
  });

  test("logout clears legacy kiosk.json credentials", async () => {
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
  });

  test("migrating from legacy copies once then scrubs the old secrets", async () => {
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
  });

  test("provider.json is written with mode 0o600", async () => {
    await establishProviderConnection("google-sub-perms", tokensA);
    const info = await stat(path.join(dataRoot, "provider.json"));
    assert.equal(info.mode & 0o777, 0o600);
  });

  test("commitRefreshedTokens refuses to resurrect cleared tokens or overwrite a switched account", async () => {
    await establishProviderConnection("acct-1", {
      access_token: "a1",
      refresh_token: "r1",
      expiry: 1000,
    });
    await clearProviderConnection();

    const afterLogout = await commitRefreshedTokens(
      { providerConnectionId: "acct-1", refreshToken: "r1" },
      { access_token: "stale", refresh_token: "r1", expiry: 9999 },
    );
    assert.equal(afterLogout, false);
    assert.equal((await readProvider()).tokens, null);

    await establishProviderConnection("acct-2", {
      access_token: "a2",
      refresh_token: "r2",
      expiry: 1000,
    });
    const afterSwitch = await commitRefreshedTokens(
      { providerConnectionId: "acct-1", refreshToken: "r1" },
      { access_token: "stale", refresh_token: "r1", expiry: 9999 },
    );
    assert.equal(afterSwitch, false);
    assert.equal((await readProvider()).tokens?.access_token, "a2");
  });

  test("clearProviderConnectionIfMatching only clears matching connection and refresh token", async () => {
    await establishProviderConnection("acct-2", {
      access_token: "a2",
      refresh_token: "r2",
      expiry: 1000,
    });

    assert.equal(
      await clearProviderConnectionIfMatching({
        providerConnectionId: "acct-1",
        refreshToken: "r1",
      }),
      false,
    );
    assert.equal(
      await clearProviderConnectionIfMatching({
        providerConnectionId: "acct-2",
        refreshToken: "r-other",
      }),
      false,
    );
    assert.equal((await readProvider()).tokens?.access_token, "a2");

    assert.equal(
      await clearProviderConnectionIfMatching({
        providerConnectionId: "acct-2",
        refreshToken: "r2",
      }),
      true,
    );
    assert.equal((await readProvider()).tokens, null);
  });
});
