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
  stars,
  status,
  onComplete,
  completionPending = false,
  onClaim,
  onCancelClaim,
  onRelease,
  onSkip,
  onEdit,
}: {
  label: string;
  time?: LocalTime | null;
  stars?: number;
  status: TaskRowStatus;
  onComplete?: () => void;
  completionPending?: boolean;
  onClaim?: () => void;
  onCancelClaim?: () => void;
  onRelease?: () => void;
  onSkip?: () => void;
  onEdit?: () => void;
}) {
  const done = status.kind === "done";
  return (
    <div className={styles.taskRow} data-state={status.kind}>
      {onComplete ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={done}
            disabled={done || completionPending}
            aria-label={label}
            onChange={onComplete}
          />
          {done ? <Icon name="check" size={24} /> : null}
        </label>
      ) : null}
      <div className={styles.taskCopy}>
        {onEdit ? (
          <button
            type="button"
            className={styles.taskTitleButton}
            aria-label={`Edit ${label}`}
            onClick={onEdit}
          >
            {label}
          </button>
        ) : (
          <span className={styles.taskTitle}>{label}</span>
        )}
        {time ? (
          <span className={styles.taskMeta}>{formatTaskTime(time)}</span>
        ) : null}
        {stars !== undefined ? (
          <span className={styles.taskMeta}>
            {stars} {stars === 1 ? "Star" : "Stars"}
          </span>
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
      {onRelease ? (
        <button
          type="button"
          aria-label={`Release ${label}`}
          onClick={onRelease}
          className={styles.skip}
        >
          Release
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
