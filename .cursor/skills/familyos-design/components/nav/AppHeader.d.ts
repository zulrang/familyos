/**
 * Screen header: serif title, then clock, then weather, with pill actions pushed right.
 * @startingPoint section="Navigation" subtitle="Serif title + clock + weather + actions" viewport="700x120"
 */
export interface AppHeaderProps {
  /** "Miller Family" on Calendar, "Wed, Mar 12" on Lists and Tasks. */
  title: React.ReactNode;
  time?: string;
  /** Temperature string incl. degree sign, e.g. "80°". */
  temp?: string;
  weatherIcon?: string;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function AppHeader(props: AppHeaderProps): JSX.Element;
