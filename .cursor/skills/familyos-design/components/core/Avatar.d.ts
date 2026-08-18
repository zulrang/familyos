/** Circular family-member photo with a white ring; falls back to the member's initial on their pastel tint. */
export interface AvatarProps { name?: string; src?: string; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; size?: number; ring?: boolean; style?: React.CSSProperties }
export declare function Avatar(props: AvatarProps): JSX.Element;
