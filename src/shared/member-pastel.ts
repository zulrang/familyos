/** Design-skill `tone` CSS tokens (`--member-teal`, …). Not Member Color. */
export const MEMBER_PASTELS = [
  "teal",
  "blush",
  "lilac",
  "sage",
  "coral",
  "sand",
] as const;

export type MemberPastel = (typeof MEMBER_PASTELS)[number];
