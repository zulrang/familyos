import type { CSSProperties } from "react";
import type { MemberPastel } from "@/shared/member-pastel";
import { Icon } from "./Icon";

export function Checkbox({
  checked = false,
  tone = "teal",
  size = 26,
  shape = "rounded",
  onChange,
  label,
  style,
}: {
  checked?: boolean;
  tone?: MemberPastel;
  size?: number;
  shape?: "rounded" | "circle";
  onChange?: (next: boolean) => void;
  label?: string;
  style?: CSSProperties;
}) {
  const box: CSSProperties = {
    width: size,
    height: size,
    flex: "0 0 auto",
    borderRadius:
      shape === "circle" ? "var(--radius-pill)" : "var(--radius-xs)",
    border: checked
      ? "1px solid transparent"
      : "1px solid var(--check-idle-border)",
    background: checked ? `var(--member-${tone})` : "var(--check-idle)",
    color: checked ? `var(--member-${tone}-ink)` : "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    ...style,
  };
  const mark = checked ? (
    <Icon name="check" size={Math.round(size * 0.62)} />
  ) : null;
  if (!onChange) {
    return (
      <span aria-hidden="true" style={box}>
        {mark}
      </span>
    );
  }
  return (
    <span
      style={{
        position: "relative",
        ...box,
        cursor: "pointer",
        transition: "background var(--dur-fast) var(--ease-standard)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          appearance: "none",
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          margin: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      />
      {mark ? (
        <span
          style={{
            position: "relative",
            pointerEvents: "none",
            display: "inline-flex",
          }}
        >
          {mark}
        </span>
      ) : null}
    </span>
  );
}
