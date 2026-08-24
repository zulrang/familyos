import type { HouseholdList, ListItem } from "@/lists/types";
import { AuthError } from "@/shared/auth-error";
import { ListItemConflictError, ProviderUnavailableError } from "./lists-error";
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
    expectedVersion: string,
  ) => Promise<ListItem>;
  clearCompleted: (listId: string) => Promise<void>;
  deleteItem: (
    listId: string,
    itemId: string,
    expectedVersion: string,
  ) => Promise<void>;
};

function live<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof ListItemConflictError) throw e;
      throw new ProviderUnavailableError();
    }
  };
}

/** Real Google Tasks adapter behind the ListsGateway port. */
export function googleListsGateway(): ListsGateway {
  return {
    listSelected: live(tasks.listSelectedListsWithItems),
    createList: live(tasks.insertTaskList),
    renameList: live(tasks.patchTaskList),
    addItem: live(tasks.insertTask),
    patchItem: live(tasks.patchTask),
    clearCompleted: live(tasks.clearCompleted),
    deleteItem: live(tasks.deleteTask),
  };
}
