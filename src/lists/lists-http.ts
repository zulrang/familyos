import {
  isHouseholdList,
  readHousehold,
  updateHousehold,
} from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { listsError } from "./lists-error";
import type { ListsGateway } from "./lists-gateway";

export type { ListsGateway };

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parseRequiredTitle(raw: unknown): string | null {
  const o = asObject(raw);
  if (!o || typeof o.title !== "string") return null;
  const title = o.title.trim();
  return title || null;
}

type CreateListBody = { title: string; expectedVersion: unknown };

function parseCreateList(raw: unknown): CreateListBody | null {
  const title = parseRequiredTitle(raw);
  if (!title) return null;
  const o = asObject(raw);
  return { title, expectedVersion: o?.expectedVersion };
}

type ItemPatchBody = { title?: string; done?: boolean };

function parseItemPatch(
  raw: unknown,
): { ok: true; value: ItemPatchBody } | { ok: false; error: string } {
  const o = asObject(raw);
  if (!o) return { ok: false, error: "nothing to patch" };
  const value: ItemPatchBody = {};
  if (o.title !== undefined) {
    if (typeof o.title !== "string")
      return { ok: false, error: "title required" };
    const title = o.title.trim();
    if (!title) return { ok: false, error: "title required" };
    value.title = title;
  }
  if (o.done !== undefined) {
    if (typeof o.done !== "boolean") {
      return { ok: false, error: "nothing to patch" };
    }
    value.done = o.done;
  }
  if (value.title === undefined && value.done === undefined) {
    return { ok: false, error: "nothing to patch" };
  }
  return { ok: true, value };
}

function notSelected(): Response {
  return Response.json({ error: "not a Household List" }, { status: 404 });
}

// ponytail: lazy default so tests can inject a Fake without loading Google.
async function defaultGateway(): Promise<ListsGateway> {
  const { googleListsGateway } = await import("./lists-gateway.ts");
  return googleListsGateway();
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
  const body = parseCreateList(await readJson(request));
  if (!body) return jsonError("title required", 400);

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
    const list = await gw.createList(body.title);
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
  const title = parseRequiredTitle(await readJson(request));
  if (!title) return jsonError("title required", 400);
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
  const expectedVersion = asObject(await readJson(request))?.expectedVersion;
  const household = await readHousehold();
  if (!isHouseholdList(listId, household.listIds)) return notSelected();

  const result = await updateHousehold(expectedVersion, {
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
  const title = parseRequiredTitle(await readJson(request));
  if (!title) return jsonError("title required", 400);
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
  const parsed = parseItemPatch(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  try {
    const gw = await resolveGateway(gateway);
    const item = await gw.patchItem(listId, itemId, parsed.value);
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
