import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/shared/ui/Badge";

export function DayHeader({
  weekday,
  date,
  today = false,
  style,
}: {
  weekday: string;
  date: ReactNode;
  today?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 0 8px 18px",
        ...style,
      }}
    >
      <span
        style={{ font: "var(--type-day-label)", color: "var(--text-title)" }}
      >
        {weekday}
        {today ? "" : ` ${date}`}
      </span>
      {today ? (
        <Badge tone="coral" size={30}>
          {date}
        </Badge>
      ) : null}
    </div>
  );
}
