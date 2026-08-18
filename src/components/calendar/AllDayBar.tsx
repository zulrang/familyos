import type { CSSProperties } from "react";
import type { MemberTone } from "@/lib/types";

export function AllDayBar({
  label,
  tone = "sage",
  multi = false,
  onClick,
  style,
}: {
  label: string;
  tone?: MemberTone;
  multi?: boolean;
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
        height: 34,
        padding: "0 14px",
        border: "none",
        borderRadius: "var(--radius-pill)",
        background: multi
          ? "var(--stripe-multi)"
          : `var(--member-${tone}-soft)`,
        color: "var(--text-title)",
        font: "var(--type-card-title)",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        cursor: onClick ? "pointer" : "default",
        width: "100%",
        textAlign: "left",
        ...style,
      }}
    >
      {label}
    </button>
  );
}
