import type { MemberId } from "@/members/members";

export type SeriesScope = "this" | "following" | "all";

/** Household Calendar event on the wire. `expectedVersion` is an opaque provider token. */
export type CalEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  /** Stable Household Member IDs; empty = Household Event. */
  participantIds: MemberId[];
  expectedVersion: string;
  recurringEventId?: string;
  originalStartMs?: number;
};

export type GoogleCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
};

/**
 * GET /api/events payload. `stale` means last-known cache; Display mutations
 * are unavailable until a live read succeeds.
 */
export type CalendarRead = {
  events: CalEvent[];
  stale: boolean;
};
