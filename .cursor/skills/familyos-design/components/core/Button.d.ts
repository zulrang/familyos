/**
 * Pill-shaped action button used in the FamilyOS header bar ("Schedule", "Filter", "Today").
 * @startingPoint section="Core" subtitle="Pill buttons, icon buttons, FAB" viewport="700x220"
 */
export interface ButtonProps {
  children?: React.ReactNode;
  /** secondary = white pill w/ hairline border (default); primary = brand blue; ghost = borderless. */
  variant?: 'secondary' | 'primary' | 'ghost';
  size?: 'sm' | 'md';
  /** Lucide slug shown left of the label. */
  icon?: string;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): JSX.Element;
