/** Overlapped avatars with a "+N" overflow badge, used when an event involves several members. */
export interface AvatarStackProps { people?: { name?: string; src?: string; tone?: string }[]; max?: number; size?: number; style?: React.CSSProperties }
export declare function AvatarStack(props: AvatarStackProps): JSX.Element;
