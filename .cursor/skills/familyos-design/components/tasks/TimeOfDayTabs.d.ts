/** Morning / Afternoon / Evening / Chores selector at the top of a member's task column. */
export interface TimeOfDayTab { id: string; label: string; icon: string }
export interface TimeOfDayTabsProps { tabs?: TimeOfDayTab[]; active?: string; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; onSelect?: (id: string) => void; style?: React.CSSProperties }
export declare function TimeOfDayTabs(props: TimeOfDayTabsProps): JSX.Element;
