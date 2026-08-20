import { type CSSProperties, type PointerEvent, useRef } from "react";
import type { MemberTone } from "@/shared/member-tone";
import { Checkbox } from "@/shared/ui/Checkbox";

const HOLD_MS = 500;
const HOLD_MOVE_PX = 8;

export function ListRow({
  label,
  emoji,
  checked = false,
  tone = "sand",
  onToggle,
  onEdit,
  style,
}: {
  label: string;
  emoji?: string;
  checked?: boolean;
  tone?: MemberTone;
  onToggle?: (next: boolean) => void;
  onEdit?: () => void;
  style?: CSSProperties;
}) {
  const hold = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const openedEdit = useRef(false);

  function clearHold() {
    if (hold.current != null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
    origin.current = null;
  }

  function startHold(e: PointerEvent<HTMLButtonElement>) {
    openedEdit.current = false;
    held.current = false;
    if (!onEdit) return;
    origin.current = { x: e.clientX, y: e.clientY };
    hold.current = window.setTimeout(() => {
      held.current = true;
      hold.current = null;
    }, HOLD_MS);
  }

  function moveHold(e: PointerEvent<HTMLButtonElement>) {
    if (!origin.current) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    if (dx * dx + dy * dy > HOLD_MOVE_PX * HOLD_MOVE_PX) {
      held.current = false;
      clearHold();
    }
  }

  function releaseHold() {
    const shouldEdit = held.current;
    held.current = false;
    clearHold();
    if (shouldEdit) {
      openedEdit.current = true;
      onEdit?.();
    }
  }

  function cancelHold() {
    held.current = false;
    clearHold();
  }

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerMove={moveHold}
      onPointerUp={releaseHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => {
        if (!onEdit) return;
        e.preventDefault();
        openedEdit.current = true;
        clearHold();
        onEdit();
      }}
      onClick={() => {
        if (openedEdit.current) {
          openedEdit.current = false;
          return;
        }
        onToggle?.(!checked);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "var(--pad-list-row)",
        border: "none",
        borderRadius: "var(--radius-list-row)",
        background: `var(--member-${tone})`,
        opacity: checked ? 0.55 : 1,
        cursor: "pointer",
        textAlign: "left",
        ...style,
      }}
    >
      {emoji ? (
        <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
      ) : null}
      <span
        style={{
          font: "var(--type-card-meta)",
          color: "var(--text-title)",
          textDecoration: checked ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ marginLeft: "auto" }}>
        <Checkbox checked={checked} tone={tone} />
      </span>
    </button>
  );
}
