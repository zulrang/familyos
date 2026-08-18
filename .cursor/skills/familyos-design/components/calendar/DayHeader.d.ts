/** Column header for one day. Today's date number becomes a coral badge instead of plain serif text. */
export interface DayHeaderProps { weekday: string; date: React.ReactNode; today?: boolean; style?: React.CSSProperties }
export declare function DayHeader(props: DayHeaderProps): JSX.Element;
