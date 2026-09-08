import { Icon } from "@/shared/ui/Icon";
import styles from "./TasksBoard.module.css";
import type { LocalTime } from "./types";

export function formatTaskTime(time: LocalTime): string {
  const [hours, minutes] = time.split(":");
  const hour = Number(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const wallHour = hour % 12 || 12;
  return Number(minutes) === 0
    ? `${wallHour} ${ampm}`
    : `${wallHour}:${minutes} ${ampm}`;
}

export type TaskRowStatus =
  | { kind: "open" }
  | { kind: "done" }
  | { kind: "skipped"; reason: string | null };

export function TaskRow({
  label,
  time,
  status,
  onComplete,
  onClaim,
  onCancelClaim,
  onSkip,
}: {
  label: string;
  time?: LocalTime | null;
  status: TaskRowStatus;
  onComplete?: () => void;
  onClaim?: () => void;
  onCancelClaim?: () => void;
  onSkip?: () => void;
}) {
  const done = status.kind === "done";
  return (
    <div className={styles.taskRow} data-state={status.kind}>
      {onComplete ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={done}
            disabled={done}
            aria-label={label}
            onChange={onComplete}
          />
          {done ? <Icon name="check" size={24} /> : null}
        </label>
      ) : null}
      <div className={styles.taskCopy}>
        <span className={styles.taskTitle}>{label}</span>
        {time ? (
          <span className={styles.taskMeta}>{formatTaskTime(time)}</span>
        ) : null}
        {status.kind === "skipped" ? (
          <span className={styles.taskMeta}>{status.reason ?? "Skipped"}</span>
        ) : null}
      </div>
      {onCancelClaim ? (
        <button
          type="button"
          aria-label={`Cancel claiming ${label}`}
          onClick={onCancelClaim}
          className={styles.rowAction}
        >
          <Icon name="x" size={24} />
        </button>
      ) : onClaim ? (
        <button
          type="button"
          aria-label={`Claim ${label}`}
          onClick={onClaim}
          className={styles.rowAction}
        >
          Claim
        </button>
      ) : null}
      {onSkip ? (
        <button
          type="button"
          aria-label={`Skip ${label}`}
          onClick={onSkip}
          className={styles.skip}
        >
          Skip
        </button>
      ) : null}
    </div>
  );
}
