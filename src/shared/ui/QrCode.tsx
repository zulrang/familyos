"use client";

import { encode } from "uqr";

export function QrCode({
  value,
  label,
  size = 240,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const qr = encode(value, { ecc: "M", border: 4 });
  const d = qr.data
    .flatMap((row, y) =>
      row.flatMap((on, x) => (on ? `M${x} ${y}h1v1h-1z` : [])),
    )
    .join("");
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      style={{
        display: "block",
        background: "#fff",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <path fill="#1f2a33" d={d} />
    </svg>
  );
}
