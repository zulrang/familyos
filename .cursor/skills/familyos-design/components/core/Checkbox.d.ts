/** Tap target that completes a list item or chore. Rounded square on Lists, circle on Tasks. */
export interface CheckboxProps { checked?: boolean; tone?: 'teal'|'blush'|'lilac'|'sage'|'coral'|'sand'; size?: number; shape?: 'rounded'|'circle'; onChange?: (next: boolean) => void; label?: string }
export declare function Checkbox(props: CheckboxProps): JSX.Element;
