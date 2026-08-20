/** EventSheet Who select — preserve Retired Member participant IDs. */

import type { Member } from "./types.ts";

export function whoFromIds(ids: string[]): string {
  if (ids.length === 0) return "none";
  if (ids.length === 1) return ids[0];
  return "several";
}

/** Retired IDs already on the draft — preserved across Who changes (except Nobody). */
export function historicalParticipantIds(
  members: Member[],
  memberIds: string[],
): string[] {
  const onDraft = new Set(memberIds);
  return members
    .filter((m) => m.status === "retired" && onDraft.has(m.id))
    .map((m) => m.id);
}

/** Apply Who select without wiping read-only Retired Member IDs. */
export function applyWhoSelection(
  who: string,
  members: Member[],
  memberIds: string[],
): { who: string; memberIds: string[] } {
  if (who === "none") return { who, memberIds: [] };
  if (who === "several") return { who, memberIds };
  const kept = historicalParticipantIds(members, memberIds).filter(
    (id) => id !== who,
  );
  const next = [who, ...kept];
  return {
    who: next.length > 1 ? "several" : who,
    memberIds: next,
  };
}

export function showSeveralOption(
  assignableCount: number,
  historicalCount: number,
  draft: { who: string; memberIds: string[] },
): boolean {
  return (
    draft.who === "several" ||
    draft.memberIds.length > 1 ||
    assignableCount >= 2 ||
    (historicalCount > 0 && assignableCount > 0)
  );
}
