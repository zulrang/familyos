import type { MemberId } from "@/members/members";

export type SeriesScope = "this" | "following" | "all";

export type CalEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  /** Stable Household Member IDs; empty = Household Event. */
  participantIds: MemberId[];
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
