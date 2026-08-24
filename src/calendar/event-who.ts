/** EventSheet Who select — preserve Retired Member participant IDs. */

import type { Member } from "@/members/members";

export type EventWho =
  | { kind: "none" }
  | { kind: "one"; memberId: string }
  | { kind: "several" };

export function eventWhoFromIds(ids: string[]): EventWho {
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "one", memberId: ids[0] };
  return { kind: "several" };
}

/** HTML select value for EventWho — sentinels `none` / `several` or a member id. */
export function whoSelectValue(who: EventWho): string {
  if (who.kind === "none") return "none";
  if (who.kind === "several") return "several";
  return who.memberId;
}

export function parseWhoSelect(value: string): EventWho {
  if (value === "none") return { kind: "none" };
  if (value === "several") return { kind: "several" };
  return { kind: "one", memberId: value };
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
  who: EventWho,
  members: Member[],
  memberIds: string[],
): { who: EventWho; memberIds: string[] } {
  if (who.kind === "none") return { who, memberIds: [] };
  if (who.kind === "several") return { who, memberIds };
  const kept = historicalParticipantIds(members, memberIds).filter(
    (id) => id !== who.memberId,
  );
  const next = [who.memberId, ...kept];
  return {
    who: next.length > 1 ? { kind: "several" } : who,
    memberIds: next,
  };
}

export function showSeveralOption(
  assignableCount: number,
  historicalCount: number,
  draft: { who: EventWho; memberIds: string[] },
): boolean {
  return (
    draft.who.kind === "several" ||
    draft.memberIds.length > 1 ||
    assignableCount >= 2 ||
    (historicalCount > 0 && assignableCount > 0)
  );
}
