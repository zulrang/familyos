import type { HouseholdListId } from "@/settings/types";

export type { HouseholdListId };

/** Provider tasklist available for Household List selection (Settings picker). */
export type GoogleTasklist = {
  id: string;
  title: string;
};

/** List Item on the wire. */
export type ListItem = {
  id: string;
  title: string;
  done: boolean;
};

/** Household List panel payload (selected tasklist + its List Items). */
export type HouseholdList = {
  id: HouseholdListId;
  title: string;
  items: ListItem[];
};

/**
 * GET /api/lists payload. `stale` means last-known cache; Display mutations
 * are unavailable until a live read succeeds.
 */
export type ListsRead = {
  lists: HouseholdList[];
  stale: boolean;
};
