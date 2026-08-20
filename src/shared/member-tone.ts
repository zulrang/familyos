export const MEMBER_TONES = [
  "teal",
  "blush",
  "lilac",
  "sage",
  "coral",
  "sand",
] as const;

export type MemberTone = (typeof MEMBER_TONES)[number];
