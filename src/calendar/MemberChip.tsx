import type { CSSProperties } from "react";
import type { MemberPastel } from "@/shared/member-pastel";
import { Avatar } from "@/shared/ui/Avatar";

export function MemberChip({
  name,
  src,
  tone = "teal",
  surface,
  count,
  active = true,
  onClick,
  style,
}: {
  name: string;
  src?: string;
  tone?: MemberPastel;
  surface?: { soft: string; ink: string };
  count?: string;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 18px 5px 6px",
        border: "none",
        borderRadius: "var(--radius-pill)",
        background: active
          ? (surface?.soft ?? `var(--member-${tone}-soft)`)
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
      <Avatar name={name} src={src} tone={tone} surface={surface} size={30} />
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
