import type { MemberId } from "@/members/members";

export const PARTICIPANTS_PROP = "familyosParticipants";

export type ParticipantIds = MemberId[];

export function parseParticipantIds(
  stored: string | null | undefined,
): ParticipantIds {
  if (stored == null || stored === "") return [];
  const out: MemberId[] = [];
  const seen = new Set<string>();
  for (const part of stored.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function serializeParticipantIds(ids: ParticipantIds): string {
  const out: MemberId[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.join(",");
}

export function normalizeParticipantIds(
  ids: readonly string[],
): ParticipantIds {
  return parseParticipantIds(ids.join(","));
}

export function isHouseholdEvent(ids: ParticipantIds): boolean {
  return ids.length === 0;
}
