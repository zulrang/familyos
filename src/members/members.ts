/** Household Member roster: Active / Retired, Member Color, no email. */

export const MAX_ACTIVE_MEMBERS = 6;

/** Design-skill pastel fills — migration from legacy `tone` only. */
export const LEGACY_TONE_COLORS = {
  teal: "#a9d8d2",
  blush: "#f6c9c5",
  lilac: "#dccfea",
  sage: "#c8e5cd",
  coral: "#f9c0bc",
  sand: "#f7e3c8",
} as const;

export type LegacyTone = keyof typeof LEGACY_TONE_COLORS;

export type MemberId = string;

/** Normalized FamilyOS `#rrggbb` presentation color (not Google colorId). */
export type MemberColor = string;

export type ActiveMember = {
  id: MemberId;
  name: string;
  status: "active";
  color: MemberColor;
};

export type RetiredMember = {
  id: MemberId;
  name: string;
  status: "retired";
};

export type HouseholdMember = ActiveMember | RetiredMember;

/** Public roster element (Active or Retired). */
export type Member = HouseholdMember;

export type RosterError =
  | "too_many_active"
  | "duplicate_active_color"
  | "duplicate_id"
  | "invalid_color"
  | "invalid_member";

export type ParseRosterResult =
  | { ok: true; members: HouseholdMember[] }
  | { ok: false; error: RosterError };

const COLOR_RE = /^#[0-9a-f]{6}$/;

export function parseMemberColor(raw: unknown): MemberColor | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.startsWith("#")
    ? `#${raw.slice(1).toLowerCase()}`
    : null;
  if (!normalized || !COLOR_RE.test(normalized)) return null;
  return normalized;
}

function legacyColor(raw: Record<string, unknown>): MemberColor | null {
  if ("color" in raw) return parseMemberColor(raw.color);
  if (typeof raw.tone === "string" && raw.tone in LEGACY_TONE_COLORS) {
    return LEGACY_TONE_COLORS[raw.tone as LegacyTone];
  }
  return null;
}

function parseOne(raw: unknown): HouseholdMember | RosterError {
  if (!raw || typeof raw !== "object") return "invalid_member";
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return "invalid_member";
  if (typeof o.name !== "string") return "invalid_member";

  // Legacy rows have no status → active.
  let resolved: "active" | "retired";
  if (o.status === undefined) resolved = "active";
  else if (o.status === "active") resolved = "active";
  else if (o.status === "retired") resolved = "retired";
  else return "invalid_member";

  if (resolved === "retired") {
    return { id: o.id, name: o.name, status: "retired" };
  }

  const color = legacyColor(o);
  if (!color) return "invalid_color";
  return { id: o.id, name: o.name, status: "active", color };
}

/**
 * Lenient load path: preserve stable IDs when stored roster violates
 * active-count/color rules by retiring the conflicting rows.
 */
export function migrateRoster(raw: unknown): HouseholdMember[] {
  if (!Array.isArray(raw)) return [];
  const members: HouseholdMember[] = [];
  const ids = new Set<string>();
  const colors = new Set<string>();
  let activeCount = 0;

  for (const item of raw) {
    const one = parseOne(item);
    if (typeof one === "string") continue;
    if (ids.has(one.id)) continue;
    ids.add(one.id);
    if (one.status === "active") {
      if (activeCount >= MAX_ACTIVE_MEMBERS || colors.has(one.color)) {
        members.push({ id: one.id, name: one.name, status: "retired" });
        continue;
      }
      activeCount += 1;
      colors.add(one.color);
    }
    members.push(one);
  }
  return members;
}

export function parseRoster(raw: unknown): ParseRosterResult {
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_member" };

  const members: HouseholdMember[] = [];
  const ids = new Set<string>();
  const colors = new Set<string>();
  let activeCount = 0;

  for (const item of raw) {
    const one = parseOne(item);
    if (typeof one === "string") return { ok: false, error: one };
    if (ids.has(one.id)) return { ok: false, error: "duplicate_id" };
    ids.add(one.id);
    if (one.status === "active") {
      activeCount += 1;
      if (activeCount > MAX_ACTIVE_MEMBERS) {
        return { ok: false, error: "too_many_active" };
      }
      if (colors.has(one.color)) {
        return { ok: false, error: "duplicate_active_color" };
      }
      colors.add(one.color);
    }
    members.push(one);
  }

  return { ok: true, members };
}

export function activeMembers(roster: HouseholdMember[]): ActiveMember[] {
  return roster.filter((m): m is ActiveMember => m.status === "active");
}

export function memberById(
  roster: HouseholdMember[],
  id: MemberId,
): HouseholdMember | undefined {
  return roster.find((m) => m.id === id);
}

/** Resolve by stable IDs — includes Retired Members (historical events). */
export function resolveMembers(
  roster: HouseholdMember[],
  ids: MemberId[],
): HouseholdMember[] {
  const out: HouseholdMember[] = [];
  for (const id of ids) {
    const m = memberById(roster, id);
    if (m) out.push(m);
  }
  return out;
}

/** Retire by id: preserve identity, free Member Color. Null if missing. */
export function retireMember(
  roster: HouseholdMember[],
  id: MemberId,
): HouseholdMember[] | null {
  const idx = roster.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  const cur = roster[idx];
  if (cur.status === "retired") return roster;
  const next = roster.slice();
  next[idx] = { id: cur.id, name: cur.name, status: "retired" };
  return next;
}

const COLOR_TO_LEGACY_TONE = Object.fromEntries(
  Object.entries(LEGACY_TONE_COLORS).map(([tone, color]) => [color, tone]),
) as Record<MemberColor, LegacyTone>;

/**
 * Map a Member Color back onto the design-skill pastel name when it matches.
 * Custom colors have no legacy tone — callers fall back for Google/CSS-var paths.
 */
export function legacyToneForColor(color: MemberColor): LegacyTone | null {
  return COLOR_TO_LEGACY_TONE[color] ?? null;
}
