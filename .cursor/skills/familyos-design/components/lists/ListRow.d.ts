/** A single list item: optional leading emoji, label, and a trailing rounded checkbox on a solid tinted row. */
export interface ListRowProps { label: string; emoji?: string; checked?: boolean; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; onToggle?: (next: boolean) => void; style?: React.CSSProperties }
export declare function ListRow(props: ListRowProps): JSX.Element;
