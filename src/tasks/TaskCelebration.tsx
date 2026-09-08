import { type CSSProperties, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { type ActiveMember, memberSurface } from "@/members/members";
import styles from "./TaskCelebration.module.css";

const CONFETTI = Array.from({ length: 72 }, (_, index) => ({
  id: index,
  left: `${(index * 37) % 100}%`,
  delay: `${(index % 12) * 0.09}s`,
  duration: `${2.8 + (index % 7) * 0.23}s`,
  color: ["#ef6c4d", "#d9a02b", "#3fae9a", "#a992cc", "#63a9dd"][index % 5],
}));

export function TaskCelebration({
  member,
  onDismiss,
}: {
  member: ActiveMember;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = memberSurface(member.color);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const timeout = window.setTimeout(onDismiss, 6500);
    return () => {
      window.clearTimeout(timeout);
      element?.close();
    };
  }, [onDismiss]);

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.overlay}
      aria-labelledby="task-celebration-title"
      aria-describedby="task-celebration-description"
      onCancel={onDismiss}
      style={
        {
          "--celebration-fill": surface.fill,
          "--celebration-ink": surface.ink,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss celebration"
      >
        <span className={styles.confetti} aria-hidden="true">
          {CONFETTI.map((piece) => (
            <i
              key={piece.id}
              style={{
                left: piece.left,
                background: piece.color,
                animationDelay: piece.delay,
                animationDuration: piece.duration,
              }}
            />
          ))}
        </span>
        <span className={styles.content}>
          <span className={styles.medal} aria-hidden="true">
            ✓
          </span>
          <span className={styles.eyebrow}>You did it, {member.name}!</span>
          <span id="task-celebration-title" className={styles.title}>
            All done!
          </span>
          <span
            id="task-celebration-description"
            className={styles.description}
          >
            Every task for today. Look at you go.
          </span>
          <span className={styles.hint}>Tap anywhere to keep going</span>
        </span>
      </button>
    </dialog>,
    document.body,
  );
}
