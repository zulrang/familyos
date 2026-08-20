/** Event Participants: stable Household Member IDs only (ADR 0002). */

import type { MemberId } from "@/members/members";

/** Google Calendar private property key for participant IDs. */
export const PARTICIPANTS_PROP = "familyosParticipants";

/**
 * Ordered unique Household Member IDs on an event.
 * Empty means Household Event (no Event Participants).
 */
export type ParticipantIds = MemberId[];

/** Parse private-property payload. Missing/empty → Household Event. */
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

/** Serialize for Google private props. Empty string clears prior IDs. */
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

/** Normalize a list of IDs (API / write path). */
export function normalizeParticipantIds(
  ids: readonly string[],
): ParticipantIds {
  return parseParticipantIds(ids.join(","));
}

export function isHouseholdEvent(ids: ParticipantIds): boolean {
  return ids.length === 0;
}
