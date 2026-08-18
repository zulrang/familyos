/**
 * A timed calendar event: member-tinted rounded block with bold title, time range, and attendee avatars.
 * @startingPoint section="Calendar" subtitle="Tinted event blocks incl. multi-member stripes" viewport="700x260"
 */
export interface EventCardProps {
  title: string;
  /** e.g. "9:30 - 10:15 AM". */
  time?: string;
  tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand';
  /** Shared by several members: fills with the diagonal pastel stripe instead of one tint. */
  multi?: boolean;
  people?: { name?: string; src?: string; tone?: string }[];
  /** Pixel height when placed on the time grid. */
  height?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function EventCard(props: EventCardProps): JSX.Element;
