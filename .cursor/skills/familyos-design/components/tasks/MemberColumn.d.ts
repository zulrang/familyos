/**
 * A full per-member column on the Tasks screen: avatar + name, score pills, progress, time-of-day tabs, then task sections.
 * @startingPoint section="Tasks" subtitle="Per-member chore column with progress" viewport="700x420"
 */
export interface MemberColumnProps {
  name: string;
  src?: string;
  tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand';
  /** Chores completed today. */
  done?: number;
  total?: number;
  /** Reward points; omit to hide the star pill. */
  points?: number;
  activeTab?: string;
  onTab?: (id: string) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function MemberColumn(props: MemberColumnProps): JSX.Element;
