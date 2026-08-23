import type { HouseholdList, ListItem } from "@/lists/types";
import * as tasks from "./tasks";

/** Port for Household Lists provider operations (Google Tasks adapter / Fake). */
export type ListsGateway = {
  listSelected: (listIds: string[]) => Promise<HouseholdList[]>;
  createList: (title: string) => Promise<HouseholdList>;
  renameList: (
    listId: string,
    title: string,
  ) => Promise<{ id: string; title: string }>;
  addItem: (listId: string, title: string) => Promise<ListItem>;
  patchItem: (
    listId: string,
    itemId: string,
    patch: { title?: string; done?: boolean },
  ) => Promise<ListItem>;
  clearCompleted: (listId: string) => Promise<void>;
  deleteItem: (listId: string, itemId: string) => Promise<void>;
};

/** Real Google Tasks adapter behind the ListsGateway port. */
export function googleListsGateway(): ListsGateway {
  return {
    listSelected: tasks.listSelectedListsWithItems,
    createList: tasks.insertTaskList,
    renameList: tasks.patchTaskList,
    addItem: tasks.insertTask,
    patchItem: tasks.patchTask,
    clearCompleted: tasks.clearCompleted,
    deleteItem: tasks.deleteTask,
  };
}
