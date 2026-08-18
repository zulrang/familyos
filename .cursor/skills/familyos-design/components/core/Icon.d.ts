/** Lucide glyph rendered as a CSS mask so it inherits colour. */
export interface IconProps {
  /** Lucide icon slug, e.g. "calendar", "eye-off", "plus". */
  name: string;
  /** Box size in px. Default 20. */
  size?: number;
  /** Override colour; defaults to currentColor. */
  strokeColor?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element;
