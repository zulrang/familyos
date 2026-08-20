import type { CSSProperties } from "react";
import type { MemberTone } from "@/shared/member-tone";
import { Checkbox } from "@/shared/ui/Checkbox";

export function ListRow({
  label,
  emoji,
  checked = false,
  tone = "sand",
  onToggle,
  style,
}: {
  label: string;
  emoji?: string;
  checked?: boolean;
  tone?: MemberTone;
  onToggle?: (next: boolean) => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle?.(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "var(--pad-list-row)",
        border: "none",
        borderRadius: "var(--radius-list-row)",
        background: `var(--member-${tone})`,
        opacity: checked ? 0.55 : 1,
        cursor: "pointer",
        textAlign: "left",
        ...style,
      }}
    >
      {emoji ? (
        <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
      ) : null}
      <span
        style={{
          font: "var(--type-card-meta)",
          color: "var(--text-title)",
          textDecoration: checked ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ marginLeft: "auto" }}>
        <Checkbox checked={checked} tone={tone} />
      </span>
    </button>
  );
}
