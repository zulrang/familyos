"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { FAMILYOS_NAV } from "@/shared/nav";
import { Icon } from "@/shared/ui/Icon";

export type NavRailItem = { id: string; label: string; icon: string };

export function NavRail({
  items = FAMILYOS_NAV,
  brand = "F",
  style,
}: {
  items?: readonly NavRailItem[];
  brand?: string;
  style?: CSSProperties;
}) {
  const path = usePathname();
  const active = path === "/" ? "calendar" : path.slice(1).split("/")[0];
  return (
    <nav
      style={{
        width: "var(--rail-width)",
        flex: "0 0 var(--rail-width)",
        background: "var(--surface-rail)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        height: "100%",
        ...style,
      }}
    >
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: "var(--fw-semibold) 24px/1 var(--font-display)",
          color: "var(--neutral-600)",
          background: "var(--surface-rail-active)",
        }}
      >
        {brand}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {items.map((it) => {
          const on = it.id === active;
          return (
            <Link
              key={it.id}
              href={it.id === "calendar" ? "/" : `/${it.id}`}
              prefetch={false}
              style={{
                border: "none",
                background: on ? "var(--white)" : "transparent",
                color: on ? "var(--text-title)" : "var(--neutral-600)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "13px 2px",
                marginTop: it.id === "sleep" ? "auto" : 0,
                font: "var(--type-nav-label)",
              }}
            >
              <Icon name={it.icon} size={22} />
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
