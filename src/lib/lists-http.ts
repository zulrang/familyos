import { isUnauthorized, requireTrustedDisplay } from "./display-auth.ts";
import { listsError } from "./lists-error.ts";
import { isHouseholdList, readHousehold, updateHousehold } from "./settings.ts";
import type { TaskItem, TaskList } from "./types.ts";

export type ListsGateway = {
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

function notSelected(): Response {
  return Response.json({ error: "not a Household List" }, { status: 404 });
}

// ponytail: lazy default so Node self-checks can inject a fake gateway without loading Google.
async function defaultGateway(): Promise<ListsGateway> {
  const tasks = await import("./tasks.ts");
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

async function resolveGateway(gateway?: ListsGateway): Promise<ListsGateway> {
  return gateway ?? (await defaultGateway());
}

async function requireSelectedList(listId: string): Promise<Response | null> {
  const { listIds } = await readHousehold();
  if (!isHouseholdList(listId, listIds)) return notSelected();
  return null;
}

function versionConflict(config: {
  listIds: string[];
  configVersion: number;
}): Response {
  return Response.json(
    {
      error: "version",
      listIds: config.listIds,
      configVersion: config.configVersion,
    },
    { status: 409 },
  );
}

export async function handleGetLists(
  request: Request,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  try {
    const gw = await resolveGateway(gateway);
    const { listIds } = await readHousehold();
    const lists = await gw.listSelected(listIds);
    return Response.json({ lists });
  } catch (e) {
    return listsError(e);
  }
}

export async function handleCreateList(
  request: Request,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const body = (await request.json()) as {
    title?: string;
    expectedVersion?: unknown;
  };
  const title = body.title?.trim();
  if (!title)
    return Response.json({ error: "title required" }, { status: 400 });

  try {
    const household = await readHousehold();
    if (
      typeof body.expectedVersion !== "number" ||
      !Number.isInteger(body.expectedVersion) ||
      body.expectedVersion !== household.configVersion
    ) {
      return versionConflict(household);
    }
    const gw = await resolveGateway(gateway);
    const list = await gw.createList(title);
    const result = await updateHousehold(body.expectedVersion, {
      listIds: [...household.listIds, list.id],
    });
    if (!result.ok) {
      // Race after pre-check: provider list may exist; do not return it (unselected).
      return versionConflict(result.config);
    }
    return Response.json({
      list,
      listIds: result.config.listIds,
      configVersion: result.config.configVersion,
    });
  } catch (e) {
    return listsError(e);
  }
}

export async function handleRenameList(
  request: Request,
  listId: string,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const denied = await requireSelectedList(listId);
  if (denied) return denied;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title)
    return Response.json({ error: "title required" }, { status: 400 });
  try {
    const gw = await resolveGateway(gateway);
    const list = await gw.renameList(listId, title);
    return Response.json({ list });
  } catch (e) {
    return listsError(e);
  }
}

/**
 * Remove a Household List panel: unselect only. Never deletes provider data.
 */
export async function handleUnselectList(
  request: Request,
  listId: string,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const body = (await request.json().catch(() => ({}))) as {
    expectedVersion?: unknown;
  };
  const household = await readHousehold();
  if (!isHouseholdList(listId, household.listIds)) return notSelected();

  const result = await updateHousehold(body.expectedVersion, {
    listIds: household.listIds.filter((id) => id !== listId),
  });
  if (!result.ok) {
    return versionConflict(result.config);
  }
  return Response.json({
    ok: true,
    listIds: result.config.listIds,
    configVersion: result.config.configVersion,
  });
}

export async function handleAddItem(
  request: Request,
  listId: string,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const denied = await requireSelectedList(listId);
  if (denied) return denied;
  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title)
    return Response.json({ error: "title required" }, { status: 400 });
  try {
    const gw = await resolveGateway(gateway);
    const item = await gw.addItem(listId, title);
    return Response.json({ item });
  } catch (e) {
    return listsError(e);
  }
}

export async function handlePatchItem(
  request: Request,
  listId: string,
  itemId: string,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const denied = await requireSelectedList(listId);
  if (denied) return denied;
  const body = (await request.json()) as { title?: string; done?: boolean };
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  if (title === undefined && typeof body.done !== "boolean") {
    return Response.json({ error: "nothing to patch" }, { status: 400 });
  }
  if (title !== undefined && !title) {
    return Response.json({ error: "title required" }, { status: 400 });
  }
  try {
    const gw = await resolveGateway(gateway);
    const item = await gw.patchItem(listId, itemId, {
      title,
      done: body.done,
    });
    return Response.json({ item });
  } catch (e) {
    return listsError(e);
  }
}

export async function handleClearCompleted(
  request: Request,
  listId: string,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const denied = await requireSelectedList(listId);
  if (denied) return denied;
  try {
    const gw = await resolveGateway(gateway);
    await gw.clearCompleted(listId);
    return Response.json({ ok: true });
  } catch (e) {
    return listsError(e);
  }
}

export async function handleDeleteItem(
  request: Request,
  listId: string,
  itemId: string,
  gateway?: ListsGateway,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const denied = await requireSelectedList(listId);
  if (denied) return denied;
  try {
    const gw = await resolveGateway(gateway);
    await gw.deleteItem(listId, itemId);
    return Response.json({ ok: true });
  } catch (e) {
    return listsError(e);
  }
}
