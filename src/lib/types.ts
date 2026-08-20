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

export const UI_SCALES = [1, 1.1, 1.25, 1.5] as const;
export type UiScale = (typeof UI_SCALES)[number];

export function parseUiScale(value: unknown, fallback: UiScale = 1): UiScale {
  return UI_SCALES.includes(value as UiScale) ? (value as UiScale) : fallback;
}

export type PublicSettings = {
  familyName: string;
  members: Member[];
  calendarId: string | null;
  signedIn: boolean;
  googleConfigured: boolean;
  uiScale: UiScale;
  configVersion: number;
};

export type GoogleCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
};

export type TaskItem = {
  id: string;
  title: string;
  done: boolean;
};

export type TaskList = {
  id: string;
  title: string;
  items: TaskItem[];
};
