import type { TaskItem, TaskList } from "@/lists/types";
import type { ListsGateway } from "./lists-gateway";

export type FakeListsGateway = ListsGateway & {
  readonly store: Map<string, TaskList>;
  readonly createCount: number;
};

/**
 * In-memory ListsGateway. Lives beside the Google Tasks adapter (`tasks.ts`).
 */
export function createFakeListsGateway(
  seed: Iterable<TaskList> = [],
): FakeListsGateway {
  const store = new Map<string, TaskList>();
  for (const list of seed) {
    store.set(list.id, {
      id: list.id,
      title: list.title,
      items: list.items.map((i) => ({ ...i })),
    });
  }

  let createCount = 0;

  const gateway: FakeListsGateway = {
    get store() {
      return store;
    },
    get createCount() {
      return createCount;
    },

    async listSelected(listIds) {
      return listIds
        .map((id) => store.get(id))
        .filter((l): l is TaskList => l !== undefined)
        .map((l) => ({
          id: l.id,
          title: l.title,
          items: l.items.map((i) => ({ ...i })),
        }));
    },

    async createList(title) {
      createCount += 1;
      const id = `tl-new-${createCount}`;
      const list: TaskList = { id, title, items: [] };
      store.set(id, list);
      return { ...list, items: [] };
    },

    async renameList(listId, title) {
      const cur = store.get(listId);
      if (!cur) throw new Error("missing");
      store.set(listId, { ...cur, title });
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
      return { ...item };
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
      return { ...item };
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

  return gateway;
}
