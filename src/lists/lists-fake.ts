import type { HouseholdList, ListItem } from "@/lists/types";
import { ListItemConflictError, ProviderUnavailableError } from "./lists-error";
import type { ListsGateway } from "./lists-gateway";

export type FakeListsGateway = ListsGateway & {
  readonly store: Map<string, HouseholdList>;
  readonly createCount: number;
  offline: boolean;
};

/**
 * In-memory ListsGateway. Lives beside the Google Tasks adapter (`tasks.ts`).
 */
export function createFakeListsGateway(
  seed: Iterable<HouseholdList> = [],
): FakeListsGateway {
  let createCount = 0;
  let offline = false;
  let versionSeq = 0;

  function requireLive(): void {
    if (offline) throw new ProviderUnavailableError();
  }

  function nextVersion(): string {
    versionSeq += 1;
    return `v${versionSeq}`;
  }

  const store = new Map<string, HouseholdList>();
  for (const list of seed) {
    store.set(list.id, {
      id: list.id,
      title: list.title,
      items: list.items.map((i) => ({
        ...i,
        expectedVersion: i.expectedVersion || nextVersion(),
      })),
    });
  }

  function requireVersion(item: ListItem, expectedVersion: string): void {
    if (item.expectedVersion !== expectedVersion) {
      throw new ListItemConflictError({ ...item });
    }
  }

  const gateway: FakeListsGateway = {
    get store() {
      return store;
    },
    get createCount() {
      return createCount;
    },
    get offline() {
      return offline;
    },
    set offline(value: boolean) {
      offline = value;
    },

    async listSelected(listIds) {
      requireLive();
      return listIds
        .map((id) => store.get(id))
        .filter((l): l is HouseholdList => l !== undefined)
        .map((l) => ({
          id: l.id,
          title: l.title,
          items: l.items.map((i) => ({ ...i })),
        }));
    },

    async createList(title) {
      requireLive();
      createCount += 1;
      const id = `tl-new-${createCount}`;
      const list: HouseholdList = { id, title, items: [] };
      store.set(id, list);
      return { ...list, items: [] };
    },

    async renameList(listId, title) {
      requireLive();
      const cur = store.get(listId);
      if (!cur) throw new Error("missing");
      store.set(listId, { ...cur, title });
      return { id: listId, title };
    },

    async addItem(listId, title) {
      requireLive();
      const cur = store.get(listId);
      if (!cur) throw new Error("missing");
      const item: ListItem = {
        id: `item-${cur.items.length + 1}`,
        title,
        done: false,
        expectedVersion: nextVersion(),
      };
      store.set(listId, { ...cur, items: [item, ...cur.items] });
      return { ...item };
    },

    async patchItem(listId, itemId, patch, expectedVersion) {
      requireLive();
      const cur = store.get(listId);
      if (!cur) throw new Error("missing");
      const current = cur.items.find((i) => i.id === itemId);
      if (!current) throw new Error("missing item");
      requireVersion(current, expectedVersion);
      const item: ListItem = {
        ...current,
        title: patch.title ?? current.title,
        done: patch.done ?? current.done,
        expectedVersion: nextVersion(),
      };
      store.set(listId, {
        ...cur,
        items: cur.items.map((i) => (i.id === itemId ? item : i)),
      });
      return { ...item };
    },

    async clearCompleted(listId) {
      requireLive();
      const cur = store.get(listId);
      if (!cur) throw new Error("missing");
      store.set(listId, {
        ...cur,
        items: cur.items.filter((i) => !i.done),
      });
    },

    async deleteItem(listId, itemId, expectedVersion) {
      requireLive();
      const cur = store.get(listId);
      if (!cur) throw new Error("missing");
      const current = cur.items.find((i) => i.id === itemId);
      if (!current) throw new Error("missing item");
      requireVersion(current, expectedVersion);
      store.set(listId, {
        ...cur,
        items: cur.items.filter((i) => i.id !== itemId),
      });
    },
  };

  return gateway;
}
