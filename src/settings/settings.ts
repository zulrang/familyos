import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RosterError } from "@/members/members";
import {
  type HouseholdMember,
  migrateRoster,
  parseRoster,
} from "@/members/members";
import type { HouseholdListId } from "@/settings/types";
import { dataDir } from "@/shared/data-path";
import { fallbackTimeZone, isIanaTimeZone, parseTimeZone } from "@/shared/time";

export type HouseholdConfig = {
  familyName: string;
  members: HouseholdMember[];
  calendarId: string | null;
  calendarTimeZone: string | null;
  /** Ordered selection of Household Lists (provider tasklist IDs). */
  listIds: HouseholdListId[];
  /** IANA Household Time Zone — dates on every Display. */
  timeZone: string;
  configVersion: number;
};

const EMPTY: HouseholdConfig = {
  familyName: "Family",
  members: [],
  calendarId: null,
  calendarTimeZone: null,
  listIds: [],
  timeZone: fallbackTimeZone(),
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

function normalizeMembers(raw: unknown): HouseholdConfig["members"] {
  const parsed = parseRoster(raw);
  return parsed.ok ? parsed.members : migrateRoster(raw);
}

function normalize(
  raw: Partial<HouseholdConfig> & { members?: unknown },
): HouseholdConfig {
  const version =
    typeof raw.configVersion === "number" &&
    Number.isInteger(raw.configVersion) &&
    raw.configVersion >= 1
      ? raw.configVersion
      : 1;
  return {
    familyName:
      typeof raw.familyName === "string" ? raw.familyName : EMPTY.familyName,
    members: normalizeMembers(raw.members),
    calendarId: raw.calendarId ?? null,
    calendarTimeZone: raw.calendarTimeZone ?? null,
    listIds: parseListIds(raw.listIds),
    timeZone: parseTimeZone(raw.timeZone),
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

export async function readHousehold(): Promise<HouseholdConfig> {
  try {
    const parsed = JSON.parse(
      await readFile(householdFile(), "utf8"),
    ) as Partial<HouseholdConfig>;
    const cfg = normalize(parsed);
    if (!isIanaTimeZone(parsed.timeZone)) await writeHousehold(cfg);
    return cfg;
  } catch {
    const legacy = await migrateFromLegacy();
    if (legacy) {
      await writeHousehold(legacy);
      return legacy;
    }
    const empty = { ...EMPTY };
    await writeHousehold(empty);
    return empty;
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
  | { ok: false; reason: "version"; config: HouseholdConfig }
  | { ok: false; reason: "timeZone"; config: HouseholdConfig }
  | {
      ok: false;
      reason: "roster";
      error: RosterError;
      config: HouseholdConfig;
    };

/**
 * Apply a household patch when expectedVersion matches.
 * On mismatch (or non-integer expectedVersion), leave storage unchanged.
 * Member roster patches are validated through parseRoster.
 * listIds patches are normalized through parseListIds.
 */
export async function updateHousehold(
  expectedVersion: unknown,
  patch: Partial<
    Omit<HouseholdConfig, "configVersion" | "members" | "listIds">
  > & {
    members?: unknown;
    listIds?: unknown;
  },
): Promise<HouseholdUpdateResult> {
  const cur = await readHousehold();
  if (
    typeof expectedVersion !== "number" ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion !== cur.configVersion
  ) {
    return { ok: false, reason: "version", config: cur };
  }

  let members = cur.members;
  if (patch.members !== undefined) {
    const parsed = parseRoster(patch.members);
    if (!parsed.ok) {
      return { ok: false, reason: "roster", error: parsed.error, config: cur };
    }
    members = parsed.members;
  }

  if (patch.timeZone !== undefined && !isIanaTimeZone(patch.timeZone)) {
    return { ok: false, reason: "timeZone", config: cur };
  }

  const next: HouseholdConfig = {
    familyName:
      typeof patch.familyName === "string" ? patch.familyName : cur.familyName,
    members,
    calendarId:
      patch.calendarId === undefined ? cur.calendarId : patch.calendarId,
    calendarTimeZone:
      patch.calendarTimeZone === undefined
        ? cur.calendarTimeZone
        : patch.calendarTimeZone,
    listIds:
      patch.listIds === undefined ? cur.listIds : parseListIds(patch.listIds),
    timeZone: patch.timeZone === undefined ? cur.timeZone : patch.timeZone,
    configVersion: cur.configVersion + 1,
  };
  await writeHousehold(next);
  return { ok: true, config: next };
}
