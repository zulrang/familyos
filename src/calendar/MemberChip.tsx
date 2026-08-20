import type { CSSProperties } from "react";
import type { MemberTone } from "@/shared/member-tone";
import { Avatar } from "@/shared/ui/Avatar";

export function MemberChip({
  name,
  src,
  tone = "teal",
  count,
  active = true,
  onClick,
  style,
}: {
  name: string;
  src?: string;
  tone?: MemberTone;
  count?: string;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 18px 5px 6px",
        border: "none",
        borderRadius: "var(--radius-pill)",
        background: active
          ? `var(--member-${tone}-soft)`
          : "var(--surface-sunken)",
        color: "var(--text-body)",
        font: "var(--type-card-meta)",
        cursor: "pointer",
        flex: "1 1 0",
        minWidth: 0,
        opacity: active ? 1 : 0.5,
        ...style,
      }}
    >
      <Avatar name={name} src={src} tone={tone} size={30} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      {count ? (
        <span style={{ color: "var(--text-muted)" }}>{count}</span>
      ) : null}
    </button>
  );
}
