import type { CSSProperties } from "react";
import type { MemberPastel } from "@/shared/member-pastel";

export function AllDayBar({
  label,
  tone = "sage",
  soft,
  multi = false,
  onClick,
  style,
}: {
  label: string;
  tone?: MemberPastel;
  soft?: string;
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
          : (soft ?? `var(--member-${tone}-soft)`),
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
