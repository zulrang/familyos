import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-path.ts";
import type { HouseholdListId, Member } from "./types.ts";

export type HouseholdConfig = {
  familyName: string;
  members: Member[];
  calendarId: string | null;
  calendarTimeZone: string | null;
  /** Ordered selection of Household Lists (provider tasklist IDs). */
  listIds: HouseholdListId[];
  configVersion: number;
};

const EMPTY: HouseholdConfig = {
  familyName: "Family",
  members: [],
  calendarId: null,
  calendarTimeZone: null,
  listIds: [],
  configVersion: 1,
};

/**
 * Normalize a Household List selection: non-empty string IDs, first-seen order,
 * duplicates dropped.
 */
export function parseListIds(raw: unknown): HouseholdListId[] {
  if (!Array.isArray(raw)) return [];
  const out: HouseholdListId[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isHouseholdList(
  listId: string,
  listIds: readonly HouseholdListId[],
): boolean {
  return listIds.includes(listId);
}

function householdFile(): string {
  return path.join(dataDir(), "household.json");
}

function legacyFile(): string {
  return path.join(dataDir(), "kiosk.json");
}

function normalize(raw: Partial<HouseholdConfig>): HouseholdConfig {
  const version =
    typeof raw.configVersion === "number" &&
    Number.isInteger(raw.configVersion) &&
    raw.configVersion >= 1
      ? raw.configVersion
      : 1;
  return {
    familyName:
      typeof raw.familyName === "string" ? raw.familyName : EMPTY.familyName,
    members: Array.isArray(raw.members) ? raw.members : [],
    calendarId: raw.calendarId ?? null,
    calendarTimeZone: raw.calendarTimeZone ?? null,
    listIds: parseListIds(raw.listIds),
    configVersion: version,
  };
}

async function migrateFromLegacy(): Promise<HouseholdConfig | null> {
  try {
    const raw = await readFile(legacyFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HouseholdConfig> & {
      uiScale?: unknown;
      tokens?: unknown;
      oauthState?: unknown;
    };
    const {
      uiScale: _legacyScale,
      tokens: _tokens,
      oauthState: _oauth,
      ...rest
    } = parsed;
    return normalize(rest);
  } catch {
    return null;
  }
}

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function googleClient(): {
  id: string;
  secret: string;
  redirect: string;
} {
  const id = process.env.GOOGLE_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirect =
    process.env.GOOGLE_REDIRECT_URI ??
    "http://localhost:3000/api/auth/callback/google";
  return { id, secret, redirect };
}

export async function readHousehold(): Promise<HouseholdConfig> {
  try {
    const raw = await readFile(householdFile(), "utf8");
    return normalize(JSON.parse(raw) as Partial<HouseholdConfig>);
  } catch {
    const legacy = await migrateFromLegacy();
    if (legacy) {
      await writeHousehold(legacy);
      return legacy;
    }
    return { ...EMPTY };
  }
}

// ponytail: last-write-wins JSON file; upgrade to a write queue if concurrent Settings races show up.
export async function writeHousehold(next: HouseholdConfig): Promise<void> {
  const file = householdFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(normalize(next), null, 2)}\n`);
}

export type HouseholdUpdateResult =
  | { ok: true; config: HouseholdConfig }
  | { ok: false; config: HouseholdConfig };

/**
 * Apply a household patch when expectedVersion matches.
 * On mismatch (or non-integer expectedVersion), leave storage unchanged.
 * listIds patches are normalized through parseListIds.
 */
export async function updateHousehold(
  expectedVersion: unknown,
  patch: Partial<Omit<HouseholdConfig, "configVersion" | "listIds">> & {
    listIds?: unknown;
  },
): Promise<HouseholdUpdateResult> {
  const cur = await readHousehold();
  if (
    typeof expectedVersion !== "number" ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion !== cur.configVersion
  ) {
    return { ok: false, config: cur };
  }
  const next: HouseholdConfig = {
    familyName:
      typeof patch.familyName === "string" ? patch.familyName : cur.familyName,
    members: Array.isArray(patch.members) ? patch.members : cur.members,
    calendarId:
      patch.calendarId === undefined ? cur.calendarId : patch.calendarId,
    calendarTimeZone:
      patch.calendarTimeZone === undefined
        ? cur.calendarTimeZone
        : patch.calendarTimeZone,
    listIds:
      patch.listIds === undefined ? cur.listIds : parseListIds(patch.listIds),
    configVersion: cur.configVersion + 1,
  };
  await writeHousehold(next);
  return { ok: true, config: next };
}
