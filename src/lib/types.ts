export const MEMBER_TONES = [
  "teal",
  "blush",
  "lilac",
  "sage",
  "coral",
  "sand",
] as const;

export type MemberTone = (typeof MEMBER_TONES)[number];

export type Member = {
  id: string;
  name: string;
  email: string;
  tone: MemberTone;
};

export type SeriesScope = "this" | "following" | "all";

export type CalEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  tones: MemberTone[];
  attendeeEmails: string[];
  recurringEventId?: string;
  originalStartMs?: number;
};

export type PublicSettings = {
  familyName: string;
  members: Member[];
  calendarId: string | null;
  signedIn: boolean;
  googleConfigured: boolean;
};

export type GoogleCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
};
