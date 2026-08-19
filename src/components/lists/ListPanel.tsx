import type { CSSProperties, ReactNode } from "react";
import type { MemberTone } from "@/lib/types";
import { Badge } from "../core/Badge";

function badgeTone(tone: MemberTone): "amber" | "teal" | "lilac" | "coral" {
  if (tone === "sand") return "amber";
  if (tone === "teal" || tone === "sage") return "teal";
  if (tone === "lilac") return "lilac";
  return "coral";
}

export function ListPanel({
  title,
  count,
  tone = "sand",
  children,
  footer,
  onTitleClick,
  style,
}: {
  title: string;
  count?: ReactNode;
  tone?: MemberTone;
  children?: ReactNode;
  footer?: ReactNode;
  onTitleClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        borderRadius: "var(--radius-panel)",
        background: `var(--member-${tone}-soft)`,
        overflow: "hidden",
        ...style,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px 10px",
        }}
      >
        <h2
          style={{
            font: "var(--type-section)",
            color: "var(--text-title)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
            margin: 0,
          }}
        >
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
                display: "block",
                textAlign: "left",
              }}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        <span style={{ marginLeft: "auto" }}>
          <Badge tone={badgeTone(tone)} size={24}>
            {count}
          </Badge>
        </span>
      </header>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--gap-list-row)",
          padding: "0 10px 10px",
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
      {footer ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "0 10px 12px",
          }}
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}
