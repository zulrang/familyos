/** Filter chip in the calendar's member strip: avatar, first name, and that member's event count. */
export interface MemberChipProps { name: string; src?: string; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; count?: string; active?: boolean; onClick?: () => void; style?: React.CSSProperties }
export declare function MemberChip(props: MemberChipProps): JSX.Element;
