import type { HouseholdList, ListItem } from "@/lists/types";
import { gfetch } from "@/shared/google";
import { sortByPosition } from "./list-text";
import { ListItemConflictError } from "./lists-error";

export { listsError } from "./lists-error";

const TASKS = "https://tasks.googleapis.com/tasks/v1";

type GTaskList = { id?: string; title?: string };
type GTask = {
  id?: string;
  title?: string;
  status?: string;
  position?: string;
  deleted?: boolean;
  parent?: string;
  etag?: string;
};

async function pages<T>(
  url: string,
  extra?: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken = "";
  for (;;) {
    const u = new URL(url);
    u.searchParams.set("maxResults", "100");
    if (extra) {
      for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    }
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await gfetch(u.toString());
    if (!res.ok) throw new Error(`${u.pathname} ${res.status}`);
    const data = (await res.json()) as {
      items?: T[];
      nextPageToken?: string;
    };
    out.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

function toItem(t: GTask): ListItem | null {
  if (!t.id || t.deleted || t.parent) return null;
  return {
    id: t.id,
    title: t.title ?? "",
    done: t.status === "completed",
    expectedVersion: t.etag ?? "",
  };
}

export async function listTaskLists(): Promise<
  { id: string; title: string }[]
> {
  const items = await pages<GTaskList>(`${TASKS}/users/@me/lists`);
  return items
    .filter((l): l is GTaskList & { id: string } => Boolean(l.id))
    .map((l) => ({ id: l.id, title: l.title || "List" }));
}

export async function listTasks(listId: string): Promise<ListItem[]> {
  const raw = await pages<GTask>(
    `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`,
    { showCompleted: "true", showHidden: "true" },
  );
  const ordered = sortByPosition(
    raw
      .filter((t) => t.id && !t.deleted && !t.parent)
      .map((t) => ({ ...t, position: t.position ?? "" })),
  );
  return ordered.map(toItem).filter((t): t is ListItem => t !== null);
}

async function getTaskListMeta(
  listId: string,
): Promise<{ id: string; title: string } | null> {
  const res = await gfetch(
    `${TASKS}/users/@me/lists/${encodeURIComponent(listId)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get list ${res.status}`);
  const g = (await res.json()) as GTaskList;
  if (!g.id) return null;
  return { id: g.id, title: g.title || "List" };
}

/**
 * Load only the selected Household Lists, preserving selection order.
 * Missing provider lists are skipped (deleted outside FamilyOS).
 */
export async function listSelectedListsWithItems(
  listIds: string[],
): Promise<HouseholdList[]> {
  // ponytail: N+1 fan-out, fine at household scale
  const lists: HouseholdList[] = [];
  for (const id of listIds) {
    const meta = await getTaskListMeta(id);
    if (!meta) continue;
    lists.push({ ...meta, items: await listTasks(meta.id) });
  }
  return lists;
}

export async function insertTaskList(title: string): Promise<HouseholdList> {
  const res = await gfetch(`${TASKS}/users/@me/lists`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`insert list ${res.status} ${await res.text()}`);
  const g = (await res.json()) as GTaskList;
  if (!g.id) throw new Error("insert list returned no id");
  return { id: g.id, title: g.title || title, items: [] };
}

export async function patchTaskList(
  listId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await gfetch(
    `${TASKS}/users/@me/lists/${encodeURIComponent(listId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
  if (!res.ok) throw new Error(`patch list ${res.status} ${await res.text()}`);
  const g = (await res.json()) as GTaskList;
  if (!g.id) throw new Error("patch list returned no id");
  return { id: g.id, title: g.title || title };
}

export async function insertTask(
  listId: string,
  title: string,
): Promise<ListItem> {
  const res = await gfetch(
    `${TASKS}/lists/${encodeURIComponent(listId)}/tasks`,
    { method: "POST", body: JSON.stringify({ title }) },
  );
  if (!res.ok) throw new Error(`insert task ${res.status} ${await res.text()}`);
  const item = toItem((await res.json()) as GTask);
  if (!item) throw new Error("insert task returned no item");
  return item;
}

async function currentItem(
  listId: string,
  itemId: string,
): Promise<ListItem | null> {
  const res = await gfetch(
    `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(itemId)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get task ${res.status}`);
  return toItem((await res.json()) as GTask);
}

async function rejectIfStale(
  res: Response,
  listId: string,
  itemId: string,
): Promise<void> {
  if (res.status !== 412) return;
  throw new ListItemConflictError(await currentItem(listId, itemId));
}

export async function patchTask(
  listId: string,
  itemId: string,
  patch: { title?: string; done?: boolean },
  expectedVersion: string,
): Promise<ListItem> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.done !== undefined) {
    body.status = patch.done ? "completed" : "needsAction";
  }
  const res = await gfetch(
    `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: { "If-Match": expectedVersion },
      body: JSON.stringify(body),
    },
  );
  await rejectIfStale(res, listId, itemId);
  if (!res.ok) throw new Error(`patch task ${res.status} ${await res.text()}`);
  const item = toItem((await res.json()) as GTask);
  if (!item) throw new Error("patch task returned no item");
  return item;
}

export async function deleteTask(
  listId: string,
  itemId: string,
  expectedVersion: string,
): Promise<void> {
  const res = await gfetch(
    `${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(itemId)}`,
    { method: "DELETE", headers: { "If-Match": expectedVersion } },
  );
  await rejectIfStale(res, listId, itemId);
  if (!res.ok && res.status !== 204)
    throw new Error(`delete task ${res.status}`);
}

export async function clearCompleted(listId: string): Promise<void> {
  const res = await gfetch(
    `${TASKS}/lists/${encodeURIComponent(listId)}/clear`,
    { method: "POST" },
  );
  if (!res.ok && res.status !== 204)
    throw new Error(`clear ${res.status} ${await res.text()}`);
}
