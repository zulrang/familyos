import { type CSSProperties, useEffect, useState } from "react";
import { NOW_LINE_PX, nowLineY } from "@/calendar/calendar";

export function NowLine({
  top,
  style,
}: {
  top?: number;
  style?: CSSProperties;
}) {
  const [live, setLive] = useState(() => top ?? nowLineY(new Date()));
  useEffect(() => {
    if (top != null) return;
    const tick = () => setLive(nowLineY(new Date()));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [top]);
  const y = top ?? live;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: y,
        height: NOW_LINE_PX,
        background: "var(--now-line)",
        pointerEvents: "none",
        zIndex: 5,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: -5,
          top: -4.5,
          width: 12,
          height: 12,
          borderRadius: "var(--radius-pill)",
          background: "var(--now-line)",
        }}
      />
    </div>
  );
}
