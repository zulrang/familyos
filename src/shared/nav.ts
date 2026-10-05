import type { MemberPastel } from "@/shared/member-pastel";

/** Rail section colour: a design-skill pastel tone, or neutral grey. Not Member Color. */
export type NavTone = MemberPastel | "neutral";

export const FAMILYOS_NAV = [
  { id: "calendar", label: "Calendar", icon: "calendar", tone: "teal" },
  { id: "lists", label: "Lists", icon: "list", tone: "sand" },
  { id: "tasks", label: "Tasks", icon: "check", tone: "sage" },
  { id: "rewards", label: "Rewards", icon: "star", tone: "coral" },
  { id: "meals", label: "Meals", icon: "utensils", tone: "blush" },
  { id: "recipes", label: "Recipes", icon: "book-open", tone: "lilac" },
  { id: "photos", label: "Photos", icon: "image", tone: "teal" },
  { id: "sleep", label: "Sleep", icon: "moon", tone: "lilac" },
  { id: "settings", label: "Settings", icon: "settings", tone: "neutral" },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: string;
  tone: NavTone;
}[];
