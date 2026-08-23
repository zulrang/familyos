import type { CSSProperties } from "react";
import type { MemberTone } from "@/shared/member-tone";
import { AvatarStack } from "@/shared/ui/AvatarStack";

export function EventCard({
  title,
  time,
  tone = "teal",
  fill,
  multi = false,
  people = [],
  height,
  onClick,
  style,
}: {
  title: string;
  time?: string;
  tone?: MemberTone;
  fill?: string;
  multi?: boolean;
  people?: {
    name?: string;
    src?: string;
    tone?: string;
    surface?: { soft: string; ink: string };
  }[];
  height?: number;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height,
        minHeight: 64,
        padding: "10px 12px",
        border: "none",
        borderRadius: "var(--radius-event)",
        background: multi
          ? "var(--stripe-multi)"
          : (fill ?? `var(--member-${tone})`),
        color: "var(--text-title)",
        cursor: onClick ? "pointer" : "default",
        overflow: "hidden",
        width: "100%",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ font: "var(--type-card-title)" }}>{title}</span>
      {time ? (
        <span
          style={{
            font: "var(--type-card-meta)",
            color: "var(--neutral-700)",
            marginTop: 2,
          }}
        >
          {time}
        </span>
      ) : null}
      {people.length ? (
        <span style={{ marginTop: "auto", alignSelf: "flex-end" }}>
          <AvatarStack people={people} size={28} />
        </span>
      ) : null}
    </button>
  );
}
