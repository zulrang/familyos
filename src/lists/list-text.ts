export function splitLeadingEmoji(title: string): {
  emoji?: string;
  label: string;
} {
  const s = title.trim();
  const first = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s),
  ][0];
  if (!first) return { label: s };
  const g = first.segment;
  if (
    !/\p{Extended_Pictographic}/u.test(g) &&
    !/\p{Regional_Indicator}/u.test(g)
  ) {
    return { label: s };
  }
  const rest = s.slice(g.length).trim();
  if (!rest) return { label: s };
  return { emoji: g, label: rest };
}

export function sortByPosition<T extends { position: string }>(
  items: T[],
): T[] {
  return items.slice().sort((a, b) => a.position.localeCompare(b.position));
}
