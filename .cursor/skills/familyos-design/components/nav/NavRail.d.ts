/**
 * Left icon rail of the FamilyOS wall display: brand tile on top, nine sections, Sleep/Settings pushed to the bottom.
 * @startingPoint section="Navigation" subtitle="FamilyOS left icon rail" viewport="700x300"
 */
export type NavTone = 'teal' | 'blush' | 'lilac' | 'sage' | 'coral' | 'sand' | 'neutral';
export interface NavRailItem { id: string; label: string; icon: string; /** Section colour: icon ink and active-slab tint. */ tone: NavTone }
export interface NavRailProps {
  items?: NavRailItem[];
  /** id of the active section — active item is a full-width soft-tint slab in its tone, with an ink accent bar. */
  active?: string;
  onSelect?: (id: string) => void;
  /** Single-character or short brand mark shown in the top tile. */
  brand?: string;
  style?: React.CSSProperties;
}
export declare const FAMILYOS_NAV: NavRailItem[];
export declare function NavRail(props: NavRailProps): JSX.Element;
