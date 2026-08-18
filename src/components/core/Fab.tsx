import type { CSSProperties } from "react";
import { Icon } from "./Icon";

export function Fab({
  icon = "plus",
  size = 64,
  label = "Add",
  onClick,
  style,
}: {
  icon?: string;
  size?: number;
  label?: string;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="fos-fab"
      aria-label={label}
      onClick={onClick}
      style={{
        position: "absolute",
        right: 26,
        bottom: 26,
        width: size,
        height: size,
        borderRadius: "var(--radius-pill)",
        border: "none",
        background: "var(--brand-blue)",
        color: "var(--text-on-fill)",
        boxShadow: "var(--shadow-fab)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 4,
        ...style,
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.44)} />
    </button>
  );
}
