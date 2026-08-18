/** A chore or routine step in a member's Tasks column; optional due time under the label, circular checkbox trailing. */
export interface TaskRowProps { label: string; time?: string; checked?: boolean; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; style?: React.CSSProperties }
export declare function TaskRow(props: TaskRowProps): JSX.Element;
