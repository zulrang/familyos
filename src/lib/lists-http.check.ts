/**
 * HTTP acceptance seam for selected Household Lists (#8).
 * Fake ListsGateway — no live Google.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-lists-"));
process.env.FAMILYOS_DATA_DIR = dataRoot;

const {
  handleGetLists,
  handleCreateList,
  handleUnselectList,
  handleAddItem,
  handlePatchItem,
  handleClearCompleted,
  handleRenameList,
  handleDeleteItem,
} = await import("./lists-http.ts");
const { writeHousehold, readHousehold } = await import("./settings.ts");
const { writeProvider } = await import("./provider.ts");
const { emitStartupPairingCode, DISPLAY_COOKIE } = await import("./pairing.ts");
const { handlePair } = await import("./pairing-http.ts");

type TaskItem = { id: string; title: string; done: boolean };
type TaskList = { id: string; title: string; items: TaskItem[] };
type ListsGateway = {
  listSelected: (listIds: string[]) => Promise<TaskList[]>;
  createList: (title: string) => Promise<TaskList>;
  renameList: (
    listId: string,
    title: string,
  ) => Promise<{ id: string; title: string }>;
  addItem: (listId: string, title: string) => Promise<TaskItem>;
  patchItem: (
    listId: string,
    itemId: string,
    patch: { title?: string; done?: boolean },
  ) => Promise<TaskItem>;
  clearCompleted: (listId: string) => Promise<void>;
  deleteItem: (listId: string, itemId: string) => Promise<void>;
};

await mkdir(dataRoot, { recursive: true });
await writeHousehold({
  familyName: "ListsHousehold",
  members: [],
  calendarId: null,
  calendarTimeZone: null,
  listIds: ["tl-selected", "tl-also"],
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

const store = new Map<string, TaskList>([
  [
    "tl-selected",
    {
      id: "tl-selected",
      title: "Selected",
      items: [{ id: "i1", title: "Milk", done: false }],
    },
  ],
  [
    "tl-also",
    {
      id: "tl-also",
      title: "Also",
      items: [{ id: "i2", title: "Done", done: true }],
    },
  ],
  [
    "tl-personal",
    {
      id: "tl-personal",
      title: "Personal",
      items: [{ id: "i3", title: "Secret", done: false }],
    },
  ],
]);

let createCount = 0;
const gateway: ListsGateway = {
  async listSelected(listIds) {
    return listIds
      .map((id) => store.get(id))
      .filter((l): l is TaskList => l !== undefined);
  },
  async createList(title) {
    createCount += 1;
    const id = `tl-new-${createCount}`;
    const list: TaskList = { id, title, items: [] };
    store.set(id, list);
    return list;
  },
  async renameList(listId, title) {
    const cur = store.get(listId);
    if (!cur) throw new Error("missing");
    const next = { ...cur, title };
    store.set(listId, next);
    return { id: listId, title };
  },
  async addItem(listId, title) {
    const cur = store.get(listId);
    if (!cur) throw new Error("missing");
    const item: TaskItem = {
      id: `item-${cur.items.length + 1}`,
      title,
      done: false,
    };
    store.set(listId, { ...cur, items: [item, ...cur.items] });
    return item;
  },
  async patchItem(listId, itemId, patch) {
    const cur = store.get(listId);
    if (!cur) throw new Error("missing");
    const items = cur.items.map((i) =>
      i.id === itemId
        ? {
            ...i,
            title: patch.title ?? i.title,
            done: patch.done ?? i.done,
          }
        : i,
    );
    store.set(listId, { ...cur, items });
    const item = items.find((i) => i.id === itemId);
    if (!item) throw new Error("missing item");
    return item;
  },
  async clearCompleted(listId) {
    const cur = store.get(listId);
    if (!cur) throw new Error("missing");
    store.set(listId, {
      ...cur,
      items: cur.items.filter((i) => !i.done),
    });
  },
  async deleteItem(listId, itemId) {
    const cur = store.get(listId);
    if (!cur) throw new Error("missing");
    store.set(listId, {
      ...cur,
      items: cur.items.filter((i) => i.id !== itemId),
    });
  },
};

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
const cookieHeader: string = cookie;

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

// --- GET returns only selected Household Lists, in selection order ---
{
  const res = await handleGetLists(
    req("http://familyos.test/api/lists"),
    gateway,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { lists: TaskList[] };
  assert.deepEqual(
    body.lists.map((l) => l.id),
    ["tl-selected", "tl-also"],
  );
  assert.equal(
    body.lists.some((l) => l.id === "tl-personal"),
    false,
  );
}

// --- Mutations on an unselected tasklist are rejected ---
{
  const rejected = [
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
  ];
  for (const res of rejected) {
    assert.equal(res.status, 404);
  }
  assert.equal(store.get("tl-personal")?.items[0]?.done, false);
  assert.equal(store.get("tl-personal")?.title, "Personal");
}

// --- Add / check / uncheck / clear work on selected lists ---
{
  const add = await handleAddItem(
    req("http://familyos.test/api/lists/tl-selected/items", {
      method: "POST",
      body: JSON.stringify({ title: "Bread" }),
    }),
    "tl-selected",
    gateway,
  );
  assert.equal(add.status, 200);
  const added = (await add.json()) as { item: TaskItem };
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
  assert.equal(((await check.json()) as { item: TaskItem }).item.done, true);

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
  assert.equal(((await uncheck.json()) as { item: TaskItem }).item.done, false);

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
    req("http://familyos.test/api/lists/tl-selected/clear", { method: "POST" }),
    "tl-selected",
    gateway,
  );
  assert.equal(clear.status, 200);
  assert.equal(
    store.get("tl-selected")?.items.some((i) => i.id === added.item.id),
    false,
  );
}

// --- Create selects the new Google tasklist under versioning ---
{
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
    list: TaskList;
    listIds: string[];
    configVersion: number;
  };
  assert.equal(body.list.title, "Errands");
  assert.ok(body.listIds.includes(body.list.id));
  assert.equal(body.configVersion, before.configVersion + 1);
  assert.deepEqual((await readHousehold()).listIds, body.listIds);
}

// --- Create with stale version conflicts and does not create ---
{
  const before = await readHousehold();
  const createdBefore = createCount;
  const res = await handleCreateList(
    req("http://familyos.test/api/lists", {
      method: "POST",
      body: JSON.stringify({ title: "Stale", expectedVersion: 1 }),
    }),
    gateway,
  );
  assert.equal(res.status, 409);
  assert.equal(createCount, createdBefore);
  const body = (await res.json()) as {
    listIds: string[];
    configVersion: number;
    list?: unknown;
  };
  assert.equal("list" in body, false);
  assert.deepEqual(body.listIds, before.listIds);
  assert.equal(body.configVersion, before.configVersion);
  assert.deepEqual((await readHousehold()).listIds, before.listIds);
}

// --- Unselect removes panel without deleting provider data ---
{
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
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    listIds: string[];
    configVersion: number;
  };
  assert.equal(body.listIds.includes(target), false);
  assert.equal(body.configVersion, before.configVersion + 1);
  assert.ok(store.has(target)); // provider data retained
  const wall = (await (
    await handleGetLists(req("http://familyos.test/api/lists"), gateway)
  ).json()) as { lists: TaskList[] };
  assert.equal(
    wall.lists.some((l) => l.id === target),
    false,
  );
}

// --- Stale unselect rejects ---
{
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
}

await rm(dataRoot, { recursive: true, force: true });
console.log("lists-http.check ok");
