import type { Member } from "@/members/members";
import type { UiScale } from "@/shared/ui-scale";

/** Provider tasklist ID selected as a Household List. */
export type HouseholdListId = string;

export type PublicSettings = {
  familyName: string;
  members: Member[];
  calendarId: string | null;
  /** Ordered Household List IDs (zero or more). */
  listIds: HouseholdListId[];
  signedIn: boolean;
  googleConfigured: boolean;
  uiScale: UiScale;
  configVersion: number;
};
