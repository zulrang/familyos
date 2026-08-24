/**
 * HTTP acceptance seam for selected Household Lists (#8), List Item
 * mutations (#9), and account-bound outage cache (#13). Uses shared
 * Lists Fake — no live Google.
 */

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { HouseholdList, ListItem } from "@/lists/types";
import { createFakeListsGateway } from "./lists-fake";

describe("Household Lists HTTP", () => {
  let dataRoot: string;
  let handleGetLists: typeof import("./lists-http.ts").handleGetLists;
  let handleCreateList: typeof import("./lists-http.ts").handleCreateList;
  let handleUnselectList: typeof import("./lists-http.ts").handleUnselectList;
  let handleAddItem: typeof import("./lists-http.ts").handleAddItem;
  let handlePatchItem: typeof import("./lists-http.ts").handlePatchItem;
  let handleClearCompleted: typeof import("./lists-http.ts").handleClearCompleted;
  let handleRenameList: typeof import("./lists-http.ts").handleRenameList;
  let handleDeleteItem: typeof import("./lists-http.ts").handleDeleteItem;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let readHousehold: typeof import("@/settings/settings").readHousehold;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;

  let cookieHeader: string;
  let gateway: ReturnType<typeof createFakeListsGateway>;
  let store: ReturnType<typeof createFakeListsGateway>["store"];

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-lists-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      handleGetLists,
      handleCreateList,
      handleUnselectList,
      handleAddItem,
      handlePatchItem,
      handleClearCompleted,
      handleRenameList,
      handleDeleteItem,
    } = await import("./lists-http.ts"));
    ({ writeHousehold, readHousehold } = await import("@/settings/settings"));
    ({ writeProvider } = await import("@/shared/provider"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE } = await import(
      "@/shared/pairing"
    ));
    ({ handlePair } = await import("@/displays/pairing-http"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "ListsHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: ["tl-selected", "tl-also"],
      timeZone: "America/New_York",
      configVersion: 1,
    });
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "conn",
    });

    gateway = createFakeListsGateway([
      {
        id: "tl-selected",
        title: "Selected",
        items: [{ id: "i1", title: "Milk", done: false }],
      },
      {
        id: "tl-also",
        title: "Also",
        items: [{ id: "i2", title: "Done", done: true }],
      },
      {
        id: "tl-personal",
        title: "Personal",
        items: [{ id: "i3", title: "Secret", done: false }],
      },
    ]);
    store = gateway.store;

    function cookieFrom(res: Response): string | null {
      const raw = res.headers.getSetCookie?.() ?? [];
      if (raw.length) {
        const line = raw.find((c) => c.startsWith(`${DISPLAY_COOKIE}=`));
        return line?.split(";")[0] ?? null;
      }
      const single = res.headers.get("set-cookie");
      if (!single) return null;
      return single.split(";")[0] ?? null;
    }

    const startupCode = await emitStartupPairingCode();
    assert.ok(startupCode);
    const pairRes = await handlePair(
      new Request("http://familyos.test/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: startupCode }),
      }),
    );
    assert.equal(pairRes.status, 200);
    const cookie = cookieFrom(pairRes);
    assert.ok(cookie);
    cookieHeader = cookie;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function req(url: string, init?: RequestInit): Request {
    return new Request(url, {
      ...init,
      headers: {
        cookie: cookieHeader,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  test("GET returns only selected Household Lists in selection order", async () => {
    const res = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lists: HouseholdList[] };
    assert.deepEqual(
      body.lists.map((l) => l.id),
      ["tl-selected", "tl-also"],
    );
    assert.equal(
      body.lists.some((l) => l.id === "tl-personal"),
      false,
    );
  });

  test("mutations on unselected lists are rejected without changing provider data", async () => {
    for (const res of [
      await handleAddItem(
        req("http://familyos.test/api/lists/tl-personal/items", {
          method: "POST",
          body: JSON.stringify({ title: "Nope" }),
        }),
        "tl-personal",
        gateway,
      ),
      await handlePatchItem(
        req("http://familyos.test/api/lists/tl-personal/items/i3", {
          method: "PATCH",
          body: JSON.stringify({ done: true }),
        }),
        "tl-personal",
        "i3",
        gateway,
      ),
      await handleClearCompleted(
        req("http://familyos.test/api/lists/tl-personal/clear", {
          method: "POST",
        }),
        "tl-personal",
        gateway,
      ),
      await handleDeleteItem(
        req("http://familyos.test/api/lists/tl-personal/items/i3", {
          method: "DELETE",
        }),
        "tl-personal",
        "i3",
        gateway,
      ),
      await handleRenameList(
        req("http://familyos.test/api/lists/tl-personal", {
          method: "PATCH",
          body: JSON.stringify({ title: "Hijack" }),
        }),
        "tl-personal",
        gateway,
      ),
    ]) {
      assert.equal(res.status, 404);
    }
    assert.equal(store.get("tl-personal")?.items[0]?.done, false);
    assert.equal(store.get("tl-personal")?.title, "Personal");
  });

  test("unparseable add-item body is rejected without reaching the provider", async () => {
    const before = store.get("tl-selected")?.items.slice() ?? [];
    const res = await handleAddItem(
      req("http://familyos.test/api/lists/tl-selected/items", {
        method: "POST",
        body: JSON.stringify({ title: 12 }),
      }),
      "tl-selected",
      gateway,
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "title required");
    assert.deepEqual(store.get("tl-selected")?.items, before);
  });

  test("add, check, uncheck, and clear work on selected Household Lists", async () => {
    const add = await handleAddItem(
      req("http://familyos.test/api/lists/tl-selected/items", {
        method: "POST",
        body: JSON.stringify({ title: "Bread" }),
      }),
      "tl-selected",
      gateway,
    );
    assert.equal(add.status, 200);
    const added = (await add.json()) as { item: ListItem };
    assert.equal(added.item.title, "Bread");

    const check = await handlePatchItem(
      req(`http://familyos.test/api/lists/tl-selected/items/${added.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: true }),
      }),
      "tl-selected",
      added.item.id,
      gateway,
    );
    assert.equal(check.status, 200);
    assert.equal(((await check.json()) as { item: ListItem }).item.done, true);

    const uncheck = await handlePatchItem(
      req(`http://familyos.test/api/lists/tl-selected/items/${added.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: false }),
      }),
      "tl-selected",
      added.item.id,
      gateway,
    );
    assert.equal(uncheck.status, 200);
    assert.equal(
      ((await uncheck.json()) as { item: ListItem }).item.done,
      false,
    );

    // mark done again then clear
    await handlePatchItem(
      req(`http://familyos.test/api/lists/tl-selected/items/${added.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: true }),
      }),
      "tl-selected",
      added.item.id,
      gateway,
    );
    const clear = await handleClearCompleted(
      req("http://familyos.test/api/lists/tl-selected/clear", {
        method: "POST",
      }),
      "tl-selected",
      gateway,
    );
    assert.equal(clear.status, 200);
    assert.equal(
      store.get("tl-selected")?.items.some((i) => i.id === added.item.id),
      false,
    );
  });

  test("rename and delete List Items on selected Household Lists", async () => {
    const add = await handleAddItem(
      req("http://familyos.test/api/lists/tl-also/items", {
        method: "POST",
        body: JSON.stringify({ title: "Cheese" }),
      }),
      "tl-also",
      gateway,
    );
    assert.equal(add.status, 200);
    const added = (await add.json()) as { item: ListItem };

    const rename = await handlePatchItem(
      req(`http://familyos.test/api/lists/tl-also/items/${added.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Cheddar" }),
      }),
      "tl-also",
      added.item.id,
      gateway,
    );
    assert.equal(rename.status, 200);
    assert.equal(
      ((await rename.json()) as { item: ListItem }).item.title,
      "Cheddar",
    );
    assert.equal(
      store.get("tl-also")?.items.find((i) => i.id === added.item.id)?.title,
      "Cheddar",
    );

    const del = await handleDeleteItem(
      req(`http://familyos.test/api/lists/tl-also/items/${added.item.id}`, {
        method: "DELETE",
      }),
      "tl-also",
      added.item.id,
      gateway,
    );
    assert.equal(del.status, 200);
    assert.equal(
      store.get("tl-also")?.items.some((i) => i.id === added.item.id),
      false,
    );
  });

  test("create selects the new Google tasklist under versioning", async () => {
    const before = await readHousehold();
    const res = await handleCreateList(
      req("http://familyos.test/api/lists", {
        method: "POST",
        body: JSON.stringify({
          title: "Errands",
          expectedVersion: before.configVersion,
        }),
      }),
      gateway,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      list: HouseholdList;
      listIds: string[];
      configVersion: number;
    };
    assert.equal(body.list.title, "Errands");
    assert.ok(body.listIds.includes(body.list.id));
    assert.equal(body.configVersion, before.configVersion + 1);
    assert.deepEqual((await readHousehold()).listIds, body.listIds);
  });

  test("create with stale expectedVersion conflicts and does not create", async () => {
    const before = await readHousehold();
    const createdBefore = gateway.createCount;
    const res = await handleCreateList(
      req("http://familyos.test/api/lists", {
        method: "POST",
        body: JSON.stringify({ title: "Stale", expectedVersion: 1 }),
      }),
      gateway,
    );
    assert.equal(res.status, 409);
    assert.equal(gateway.createCount, createdBefore);
    const body = (await res.json()) as {
      listIds: string[];
      configVersion: number;
      list?: unknown;
    };
    assert.equal("list" in body, false);
    assert.deepEqual(body.listIds, before.listIds);
    assert.equal(body.configVersion, before.configVersion);
    assert.deepEqual((await readHousehold()).listIds, before.listIds);
  });

  test("unselect removes a Household List panel without deleting provider data", async () => {
    const before = await readHousehold();
    const target = before.listIds[0];
    assert.ok(target);
    assert.ok(store.has(target));

    const res = await handleUnselectList(
      req(`http://familyos.test/api/lists/${target}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: before.configVersion }),
      }),
      target,
      gateway,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      listIds: string[];
      configVersion: number;
    };
    assert.equal(body.listIds.includes(target), false);
    assert.equal(body.configVersion, before.configVersion + 1);
    assert.ok(store.has(target)); // provider data retained
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    const wall = (await (
      await handleGetLists(req("http://familyos.test/api/lists"), gateway)
    ).json()) as { lists: HouseholdList[] };
    assert.equal(
      wall.lists.some((l) => l.id === target),
      false,
    );
  });

  test("stale unselect rejects without changing Household List selection", async () => {
    const before = await readHousehold();
    const target = before.listIds[0];
    assert.ok(target);
    const res = await handleUnselectList(
      req(`http://familyos.test/api/lists/${target}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      target,
    );
    assert.equal(res.status, 409);
    assert.deepEqual((await readHousehold()).listIds, before.listIds);
  });
});

describe("Household Lists outage cache", () => {
  let dataRoot: string;
  let handleGetLists: typeof import("./lists-http.ts").handleGetLists;
  let handleAddItem: typeof import("./lists-http.ts").handleAddItem;
  let handlePatchItem: typeof import("./lists-http.ts").handlePatchItem;
  let handleClearCompleted: typeof import("./lists-http.ts").handleClearCompleted;
  let handleDeleteItem: typeof import("./lists-http.ts").handleDeleteItem;
  let handleRenameList: typeof import("./lists-http.ts").handleRenameList;
  let handleCreateList: typeof import("./lists-http.ts").handleCreateList;
  let handleUnselectList: typeof import("./lists-http.ts").handleUnselectList;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let readHousehold: typeof import("@/settings/settings").readHousehold;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;

  let cookieHeader: string;
  let gateway: ReturnType<typeof createFakeListsGateway>;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-lists-cache-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      handleGetLists,
      handleAddItem,
      handlePatchItem,
      handleClearCompleted,
      handleDeleteItem,
      handleRenameList,
      handleCreateList,
      handleUnselectList,
    } = await import("./lists-http.ts"));
    ({ writeHousehold, readHousehold } = await import("@/settings/settings"));
    ({ writeProvider } = await import("@/shared/provider"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE } = await import(
      "@/shared/pairing"
    ));
    ({ handlePair } = await import("@/displays/pairing-http"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: ["tl-groceries", "tl-chores"],
      timeZone: "America/New_York",
      configVersion: 1,
    });
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });

    gateway = createFakeListsGateway([
      {
        id: "tl-groceries",
        title: "Groceries",
        items: [{ id: "g1", title: "Milk", done: false }],
      },
      {
        id: "tl-chores",
        title: "Chores",
        items: [{ id: "c1", title: "Trash", done: true }],
      },
      {
        id: "tl-personal",
        title: "Personal",
        items: [{ id: "p1", title: "Secret", done: false }],
      },
    ]);

    function cookieFrom(res: Response): string | null {
      const raw = res.headers.getSetCookie?.() ?? [];
      if (raw.length) {
        const line = raw.find((c) => c.startsWith(`${DISPLAY_COOKIE}=`));
        return line?.split(";")[0] ?? null;
      }
      const single = res.headers.get("set-cookie");
      if (!single) return null;
      return single.split(";")[0] ?? null;
    }

    const startupCode = await emitStartupPairingCode();
    assert.ok(startupCode);
    const pairRes = await handlePair(
      new Request("http://familyos.test/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: startupCode }),
      }),
    );
    assert.equal(pairRes.status, 200);
    const cookie = cookieFrom(pairRes);
    assert.ok(cookie);
    cookieHeader = cookie;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function req(url: string, init?: RequestInit): Request {
    return new Request(url, {
      ...init,
      headers: {
        cookie: cookieHeader,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  test("an outage returns cached selected Household Lists as stale", async () => {
    const live = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(live.status, 200);
    const liveBody = (await live.json()) as {
      lists: HouseholdList[];
      stale: boolean;
    };
    assert.equal(liveBody.stale, false);
    assert.deepEqual(
      liveBody.lists.map((l) => l.id),
      ["tl-groceries", "tl-chores"],
    );

    gateway.offline = true;
    const stale = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(stale.status, 200);
    const staleBody = (await stale.json()) as {
      lists: HouseholdList[];
      stale: boolean;
    };
    assert.equal(staleBody.stale, true);
    assert.deepEqual(
      staleBody.lists.map((l) => [l.id, l.title, l.items[0]?.title]),
      [
        ["tl-groceries", "Groceries", "Milk"],
        ["tl-chores", "Chores", "Trash"],
      ],
    );
    assert.equal(
      staleBody.lists.some((l) => l.id === "tl-personal"),
      false,
    );
  });

  test("List Item and Household List mutations are unavailable while read-only", async () => {
    gateway.offline = false;
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    gateway.offline = true;
    const before = await readHousehold();
    const groceryItems = gateway.store.get("tl-groceries")?.items.slice() ?? [];

    for (const res of [
      await handleAddItem(
        req("http://familyos.test/api/lists/tl-groceries/items", {
          method: "POST",
          body: JSON.stringify({ title: "Eggs" }),
        }),
        "tl-groceries",
        gateway,
      ),
      await handlePatchItem(
        req("http://familyos.test/api/lists/tl-groceries/items/g1", {
          method: "PATCH",
          body: JSON.stringify({ done: true }),
        }),
        "tl-groceries",
        "g1",
        gateway,
      ),
      await handleClearCompleted(
        req("http://familyos.test/api/lists/tl-chores/clear", {
          method: "POST",
        }),
        "tl-chores",
        gateway,
      ),
      await handleDeleteItem(
        req("http://familyos.test/api/lists/tl-groceries/items/g1", {
          method: "DELETE",
        }),
        "tl-groceries",
        "g1",
        gateway,
      ),
      await handleRenameList(
        req("http://familyos.test/api/lists/tl-groceries", {
          method: "PATCH",
          body: JSON.stringify({ title: "Market" }),
        }),
        "tl-groceries",
        gateway,
      ),
      await handleCreateList(
        req("http://familyos.test/api/lists", {
          method: "POST",
          body: JSON.stringify({
            title: "Outage list",
            expectedVersion: before.configVersion,
          }),
        }),
        gateway,
      ),
      await handleUnselectList(
        req("http://familyos.test/api/lists/tl-groceries", {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion: before.configVersion }),
        }),
        "tl-groceries",
        gateway,
      ),
    ]) {
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "read-only");
    }

    assert.deepEqual((await readHousehold()).listIds, before.listIds);
    assert.deepEqual(gateway.store.get("tl-groceries")?.items, groceryItems);
    assert.equal(gateway.store.get("tl-groceries")?.title, "Groceries");
    assert.equal(gateway.store.get("tl-chores")?.items[0]?.done, true);
  });

  test("disconnect returns matching cache as stale without live provider data", async () => {
    gateway.offline = false;
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    await writeProvider({
      tokens: null,
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    const stale = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(stale.status, 200);
    const body = (await stale.json()) as {
      lists: HouseholdList[];
      stale: boolean;
    };
    assert.equal(body.stale, true);
    assert.deepEqual(
      body.lists.map((l) => l.id),
      ["tl-groceries", "tl-chores"],
    );
    const add = await handleAddItem(
      req("http://familyos.test/api/lists/tl-groceries/items", {
        method: "POST",
        body: JSON.stringify({ title: "Eggs" }),
      }),
      "tl-groceries",
      gateway,
    );
    assert.equal(add.status, 503);
  });

  test("a different Provider Connection never inherits the previous cache", async () => {
    gateway.offline = false;
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    await writeProvider({
      tokens: {
        access_token: "access-b",
        refresh_token: "refresh-b",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-b",
    });
    gateway.offline = true;
    const res = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    if (res.status === 200) {
      const body = (await res.json()) as {
        lists: HouseholdList[];
        stale: boolean;
      };
      assert.equal(
        body.lists.some((l) => l.id === "tl-groceries" || l.id === "tl-chores"),
        false,
      );
    } else {
      assert.ok(res.status >= 400);
    }
    await writeProvider({
      tokens: null,
      oauthState: null,
      providerConnectionId: "acct-b",
    });
    const disconnected = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    if (disconnected.status === 200) {
      const body = (await disconnected.json()) as {
        lists: HouseholdList[];
      };
      assert.equal(
        body.lists.some((l) => l.id === "tl-groceries" || l.id === "tl-chores"),
        false,
      );
    } else {
      assert.ok(disconnected.status >= 400);
    }
  });

  test("unselected Household Lists do not reappear from cache during an outage", async () => {
    gateway.offline = false;
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: ["tl-groceries", "tl-chores"],
      timeZone: "America/New_York",
      configVersion: (await readHousehold()).configVersion,
    });
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    const before = await readHousehold();
    const unselect = await handleUnselectList(
      req("http://familyos.test/api/lists/tl-groceries", {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: before.configVersion }),
      }),
      "tl-groceries",
      gateway,
    );
    assert.equal(unselect.status, 200);
    gateway.offline = true;
    const stale = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(stale.status, 200);
    const body = (await stale.json()) as {
      lists: HouseholdList[];
      stale: boolean;
    };
    assert.equal(body.stale, true);
    assert.deepEqual(
      body.lists.map((l) => l.id),
      ["tl-chores"],
    );
  });

  test("live writable behavior resumes after Google recovers", async () => {
    gateway.offline = false;
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    const live = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(live.status, 200);
    assert.equal(((await live.json()) as { stale: boolean }).stale, false);
    const add = await handleAddItem(
      req("http://familyos.test/api/lists/tl-chores/items", {
        method: "POST",
        body: JSON.stringify({ title: "Vacuum" }),
      }),
      "tl-chores",
      gateway,
    );
    assert.equal(add.status, 200);
    assert.equal(
      ((await add.json()) as { item: { title: string } }).item.title,
      "Vacuum",
    );
  });

  test("a cache write failure still returns live writable Household Lists", async () => {
    gateway.offline = false;
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: ["tl-groceries", "tl-chores"],
      timeZone: "America/New_York",
      configVersion: (await readHousehold()).configVersion,
    });
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    const chores = gateway.store.get("tl-chores");
    assert.ok(chores);
    chores.title = "Errands";
    const cacheDir = path.join(dataRoot, "cache", "lists", "acct-a");
    const cached = await readdir(cacheDir);
    for (const name of cached) {
      await chmod(path.join(cacheDir, name), 0o444);
    }
    try {
      const live = await handleGetLists(
        req("http://familyos.test/api/lists"),
        gateway,
      );
      assert.equal(live.status, 200);
      const body = (await live.json()) as {
        lists: HouseholdList[];
        stale: boolean;
      };
      assert.equal(body.stale, false);
      assert.equal(
        body.lists.find((l) => l.id === "tl-chores")?.title,
        "Errands",
      );
    } finally {
      const cached = await readdir(cacheDir);
      for (const name of cached) {
        await chmod(path.join(cacheDir, name), 0o644);
      }
      chores.title = "Chores";
    }
  });

  test("a successful List Item write is what an outage returns", async () => {
    gateway.offline = false;
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [],
      calendarId: null,
      calendarTimeZone: null,
      listIds: ["tl-groceries", "tl-chores"],
      timeZone: "America/New_York",
      configVersion: (await readHousehold()).configVersion,
    });
    assert.equal(
      (await handleGetLists(req("http://familyos.test/api/lists"), gateway))
        .status,
      200,
    );
    const add = await handleAddItem(
      req("http://familyos.test/api/lists/tl-groceries/items", {
        method: "POST",
        body: JSON.stringify({ title: "Eggs" }),
      }),
      "tl-groceries",
      gateway,
    );
    assert.equal(add.status, 200);
    gateway.offline = true;
    const stale = await handleGetLists(
      req("http://familyos.test/api/lists"),
      gateway,
    );
    assert.equal(stale.status, 200);
    const body = (await stale.json()) as {
      lists: HouseholdList[];
      stale: boolean;
    };
    assert.equal(body.stale, true);
    assert.equal(
      body.lists
        .find((l) => l.id === "tl-groceries")
        ?.items.some((i) => i.title === "Eggs"),
      true,
    );
  });
});
