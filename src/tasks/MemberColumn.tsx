import type { CSSProperties, ReactNode } from "react";
import type { MemberSurface } from "@/members/members";
import { Avatar } from "@/shared/ui/Avatar";

export function MemberColumn({
  name,
  surface,
  done,
  total,
  children,
  style,
}: {
  name: string;
  surface: MemberSurface;
  done: number;
  total: number;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const ratio = total === 0 ? 0 : done / total;
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        flex: "1 1 0",
        ...style,
      }}
    >
      <div
        style={{
          borderRadius: "var(--radius-panel)",
          background: surface.soft,
          padding: "12px 14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={name} surface={surface} size={38} />
          <h2
            style={{ font: "var(--type-section)", color: "var(--text-title)" }}
          >
            {name}
          </h2>
        </div>
        <div
          style={{
            font: "var(--type-card-meta)",
            color: surface.ink,
          }}
        >
          {done}/{total}
        </div>
        <div
          style={{
            height: 6,
            borderRadius: "var(--radius-pill)",
            background: "var(--white)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.round(ratio * 100)}%`,
              height: "100%",
              background: surface.fill,
              borderRadius: "var(--radius-pill)",
              transition: "width 200ms cubic-bezier(.2,.7,.3,1)",
            }}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--gap-list-row)",
          marginTop: 10,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </section>
  );
}
