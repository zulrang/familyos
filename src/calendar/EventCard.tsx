import type { CSSProperties } from "react";
import type { MemberPastel } from "@/shared/member-pastel";
import { AvatarStack } from "@/shared/ui/AvatarStack";

/** Shared by every surface that draws an event that has ended. */
export const PAST_EVENT_OPACITY = 0.55;

export function EventCard({
  title,
  time,
  tone = "teal",
  fill,
  ink,
  past = false,
  people = [],
  height,
  onClick,
  style,
}: {
  title: string;
  time?: string;
  tone?: MemberPastel;
  fill?: string;
  ink?: string;
  /** Dims an event that has already ended. */
  past?: boolean;
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
  const onFill = ink;
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
        background: fill ?? `var(--member-${tone})`,
        opacity: past ? PAST_EVENT_OPACITY : 1,
        color: onFill ?? "var(--text-title)",
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
            color: onFill ?? "var(--neutral-700)",
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
