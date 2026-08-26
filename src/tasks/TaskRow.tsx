import type { CSSProperties } from "react";
import { type MemberSurface, onFillInk } from "@/members/members";
import { Icon } from "@/shared/ui/Icon";
import type { LocalTime } from "./types";

export function formatTaskTime(time: LocalTime): string {
  const [hours, minutes] = time.split(":");
  const hour = Number(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const wallHour = hour % 12 || 12;
  return Number(minutes) === 0
    ? `${wallHour} ${ampm}`
    : `${wallHour}:${minutes} ${ampm}`;
}

export function TaskRow({
  label,
  time,
  done,
  surface,
  onComplete,
  onClaim,
  style,
}: {
  label: string;
  time?: LocalTime | null;
  done: boolean;
  surface: MemberSurface;
  onComplete: () => void;
  onClaim?: () => void;
  style?: CSSProperties;
}) {
  const ink = done ? onFillInk(surface.fill) : surface.ink;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "var(--pad-list-row)",
        borderRadius: "var(--radius-list-row)",
        background: done ? surface.fill : surface.soft,
        color: ink,
        transition: "background var(--dur-fast) var(--ease-standard)",
        ...style,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            font: "var(--type-card-meta)",
            color: done ? ink : "var(--text-title)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {time ? (
          <span
            style={{
              font: "var(--fw-semibold) var(--fs-caption)/1.2 var(--font-sans)",
              color: done ? ink : "var(--text-muted)",
              marginTop: 2,
            }}
          >
            {formatTaskTime(time)}
          </span>
        ) : null}
      </span>
      {onClaim ? (
        <button
          type="button"
          aria-label={`Claim ${label}`}
          onClick={onClaim}
          style={{
            marginLeft: "auto",
            minHeight: "var(--hit-min)",
            padding: "0 14px",
            border: "1px solid var(--surface-grid-line)",
            borderRadius: "var(--radius-pill)",
            background: "var(--surface-card)",
            color: "var(--text-title)",
            font: "var(--type-card-meta)",
            cursor: "pointer",
          }}
        >
          Claim
        </button>
      ) : null}
      <label
        style={{
          marginLeft: onClaim ? 0 : "auto",
          width: 26,
          height: 26,
          flex: "0 0 auto",
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: done ? ink : "transparent",
        }}
      >
        <input
          type="checkbox"
          checked={done}
          aria-label={label}
          onChange={onComplete}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            margin: 0,
            cursor: "pointer",
            borderRadius: "var(--radius-pill)",
            border: done
              ? "1px solid transparent"
              : "1px solid var(--check-idle-border)",
            background: done ? surface.fill : "var(--check-idle)",
            boxShadow: done ? `inset 0 0 0 1px ${ink}` : "none",
            transition: "background var(--dur-fast) var(--ease-standard)",
          }}
        />
        {done ? (
          <Icon
            name="check"
            size={16}
            style={{ position: "relative", pointerEvents: "none" }}
          />
        ) : null}
      </label>
    </div>
  );
}
