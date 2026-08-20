import type { CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";

type Person = { name?: string; src?: string; tone?: string };

export function AvatarStack({
  people = [],
  max = 3,
  size = 30,
  style,
}: {
  people?: Person[];
  max?: number;
  size?: number;
  style?: CSSProperties;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", ...style }}>
      {shown.map((p, i) => (
        <Avatar
          key={`${p.name}-${i}`}
          name={p.name}
          src={p.src}
          tone={p.tone}
          size={size}
          style={{ marginLeft: i ? -8 : 0 }}
        />
      ))}
      {extra > 0 ? (
        <Badge
          tone="quiet"
          size={size}
          style={{ marginLeft: -8, background: "var(--white)" }}
        >
          +{extra}
        </Badge>
      ) : null}
    </span>
  );
}
