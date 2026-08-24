import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HouseholdList, ListItem } from "@/lists/types";
import { dataDir } from "@/shared/data-path";

function cacheRoot(): string {
  return path.join(dataDir(), "cache", "lists");
}

function safeSegment(id: string): string {
  return encodeURIComponent(id);
}

function listFile(connectionId: string, listId: string): string {
  return path.join(
    cacheRoot(),
    safeSegment(connectionId),
    `${safeSegment(listId)}.json`,
  );
}

function parseItem(raw: unknown): ListItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  if (typeof o.done !== "boolean") return null;
  return { id: o.id, title: o.title, done: o.done };
}

function parseList(raw: unknown): HouseholdList | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  if (!Array.isArray(o.items)) return null;
  const items: ListItem[] = [];
  for (const row of o.items) {
    const item = parseItem(row);
    if (!item) return null;
    items.push(item);
  }
  return { id: o.id, title: o.title, items };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export async function putHouseholdListCache(
  connectionId: string,
  list: HouseholdList,
): Promise<void> {
  const file = listFile(connectionId, list.id);
  await mkdir(path.dirname(file), { recursive: true });
  // ponytail: last-write-wins JSON; upgrade if cache writes start racing.
  await writeFile(file, `${JSON.stringify(list)}\n`);
}

async function getHouseholdListCache(
  connectionId: string,
  listId: string,
): Promise<HouseholdList | null> {
  return parseList(await readJson(listFile(connectionId, listId)));
}

export async function dropHouseholdListCache(
  connectionId: string,
  listId: string,
): Promise<void> {
  try {
    await unlink(listFile(connectionId, listId));
  } catch {
    /* no cached list */
  }
}

export async function readSelectedListsCache(
  connectionId: string,
  listIds: string[],
): Promise<HouseholdList[]> {
  const lists: HouseholdList[] = [];
  for (const id of listIds) {
    const hit = await getHouseholdListCache(connectionId, id);
    if (hit) lists.push(hit);
  }
  return lists;
}
