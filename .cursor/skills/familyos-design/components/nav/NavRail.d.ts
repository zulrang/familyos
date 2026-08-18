/**
 * Left icon rail of the FamilyOS wall display: brand tile on top, nine sections, Sleep/Settings pushed to the bottom.
 * @startingPoint section="Navigation" subtitle="FamilyOS left icon rail" viewport="700x300"
 */
export interface NavRailItem { id: string; label: string; icon: string }
export interface NavRailProps {
  items?: NavRailItem[];
  /** id of the active section — active item is a white full-width slab. */
  active?: string;
  onSelect?: (id: string) => void;
  /** Single-character or short brand mark shown in the top tile. */
  brand?: string;
  style?: React.CSSProperties;
}
export declare const FAMILYOS_NAV: NavRailItem[];
export declare function NavRail(props: NavRailProps): JSX.Element;
