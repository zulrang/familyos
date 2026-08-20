export const UI_SCALES = [1, 1.1, 1.25, 1.5] as const;
export type UiScale = (typeof UI_SCALES)[number];

export function parseUiScale(value: unknown, fallback: UiScale = 1): UiScale {
  return UI_SCALES.includes(value as UiScale) ? (value as UiScale) : fallback;
}
