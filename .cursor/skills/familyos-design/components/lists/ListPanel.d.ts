/**
 * One list column on the Lists screen — soft tinted panel, serif title, count badge, rows, and an "Add section" footer.
 * @startingPoint section="Lists" subtitle="Tinted list column with rows and count" viewport="700x380"
 */
export interface ListPanelProps {
  title: string;
  count?: React.ReactNode;
  tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand';
  children?: React.ReactNode;
  /** Pass false to hide the "Add section" footer. */
  footer?: boolean | React.ReactNode;
  style?: React.CSSProperties;
}
export declare function ListPanel(props: ListPanelProps): JSX.Element;
