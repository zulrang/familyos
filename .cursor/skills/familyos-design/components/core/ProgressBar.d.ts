/** Soft capsule track showing a member's chore completion for the day. */
export interface ProgressBarProps { value?: number; max?: number; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; height?: number; style?: React.CSSProperties }
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
