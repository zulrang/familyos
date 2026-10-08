"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, useContext } from "react";
import { FAMILYOS_NAV, HOME_SECTION, type NavTone } from "@/shared/nav";
import { SleepContext } from "@/shared/SleepContext";
import { Icon } from "@/shared/ui/Icon";

export type NavRailItem = {
  id: string;
  label: string;
  icon: string;
  tone: NavTone;
};

function toneColors(tone: NavTone) {
  return tone === "neutral"
    ? { ink: "var(--neutral-700)", soft: "var(--neutral-200)" }
    : { ink: `var(--member-${tone}-ink)`, soft: `var(--member-${tone}-soft)` };
}

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
  const sleep = useContext(SleepContext);
  const active = path === "/" ? HOME_SECTION : path.slice(1).split("/")[0];
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        {items.map((it) => {
          const on = it.id === active;
          const { ink, soft } = toneColors(it.tone);
          // Rows share the rail height so all ten fit at the largest UI Scale.
          const itemStyle: CSSProperties = {
            position: "relative",
            flex: "1 1 0",
            minHeight: 0,
            maxHeight: 94,
            border: "none",
            background: on ? soft : "transparent",
            color: on ? ink : "var(--neutral-600)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "0 2px",
            marginTop: it.id === "sleep" ? "auto" : 0,
            font: "var(--type-nav-label)",
            fontWeight: on ? "var(--fw-bold)" : undefined,
          };
          const content = (
            <>
              {on ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 14,
                    bottom: 14,
                    width: 5,
                    borderRadius: "0 5px 5px 0",
                    background: ink,
                  }}
                />
              ) : null}
              <Icon name={it.icon} size={29} strokeColor={ink} />
              {it.label}
            </>
          );
          return it.id === "sleep" ? (
            <button key={it.id} type="button" onClick={sleep} style={itemStyle}>
              {content}
            </button>
          ) : (
            <Link
              key={it.id}
              href={it.id === HOME_SECTION ? "/" : `/${it.id}`}
              prefetch={false}
              aria-current={on ? "page" : undefined}
              style={itemStyle}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
