import type { BountyRecurrence, CalendarCadence } from "./bounty-calendar";
import { parseRecurringBountySchedule } from "./bounty-calendar";
import styles from "./TaskEditor.module.css";
import type { LocalDate, Weekday } from "./types";

const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] = [
  { value: "sun", label: "Sun" },
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
];

type CalendarCadenceDraft =
  | Readonly<{ kind: "daily" }>
  | Readonly<{ kind: "weekly"; days: readonly Weekday[] }>
  | Readonly<{ kind: "monthly"; day: string }>;

export type BountyRecurrenceDraft =
  | Readonly<{ kind: "once" }>
  | Readonly<{
      kind: "recurring";
      startsOn: string;
      cadence: CalendarCadenceDraft;
    }>;

export function parseBountyRecurrenceDraft(
  draft: BountyRecurrenceDraft,
): BountyRecurrence | null {
  if (draft.kind === "once") return { kind: "once" };
  const cadence: unknown =
    draft.cadence.kind === "monthly"
      ? { kind: "monthly", day: Number(draft.cadence.day) }
      : draft.cadence;
  return parseRecurringBountySchedule({
    kind: "recurring",
    startsOn: draft.startsOn,
    cadence,
  });
}

function recurring(
  draft: BountyRecurrenceDraft,
  defaultStartsOn: LocalDate,
  cadence: CalendarCadenceDraft,
): BountyRecurrenceDraft {
  return {
    kind: "recurring",
    startsOn: draft.kind === "recurring" ? draft.startsOn : defaultStartsOn,
    cadence,
  };
}

function selectedCadence(
  draft: BountyRecurrenceDraft,
): CalendarCadence["kind"] | "once" {
  return draft.kind === "once" ? "once" : draft.cadence.kind;
}

export function BountyRecurrenceEditor({
  draft,
  defaultStartsOn,
  disabled = false,
  onChange,
}: {
  draft: BountyRecurrenceDraft;
  defaultStartsOn: LocalDate;
  disabled?: boolean;
  onChange: (draft: BountyRecurrenceDraft) => void;
}) {
  const selected = selectedCadence(draft);
  const weekly =
    draft.kind === "recurring" && draft.cadence.kind === "weekly"
      ? { startsOn: draft.startsOn, days: draft.cadence.days }
      : null;
  const validationError =
    draft.kind !== "recurring" || parseBountyRecurrenceDraft(draft)
      ? null
      : !draft.startsOn
        ? "Choose a valid starting date."
        : draft.cadence.kind === "weekly" && draft.cadence.days.length === 0
          ? "Choose at least one weekday."
          : draft.cadence.kind === "monthly"
            ? "Choose a day from 1 through 28."
            : "Choose a valid starting date.";
  return (
    <fieldset
      className={`${styles.details} ${styles.recurrenceEditor}`}
      disabled={disabled}
    >
      <legend>Schedule</legend>
      <div className={styles.scheduleChoices}>
        <button
          type="button"
          aria-pressed={selected === "once"}
          onClick={() => onChange({ kind: "once" })}
        >
          Once
        </button>
        <button
          type="button"
          aria-pressed={selected === "daily"}
          onClick={() =>
            onChange(recurring(draft, defaultStartsOn, { kind: "daily" }))
          }
        >
          Daily
        </button>
        <button
          type="button"
          aria-pressed={selected === "weekly"}
          onClick={() =>
            onChange(
              recurring(draft, defaultStartsOn, {
                kind: "weekly",
                days:
                  draft.kind === "recurring" && draft.cadence.kind === "weekly"
                    ? draft.cadence.days
                    : [],
              }),
            )
          }
        >
          Weekdays
        </button>
        <button
          type="button"
          aria-pressed={selected === "monthly"}
          onClick={() =>
            onChange(
              recurring(draft, defaultStartsOn, {
                kind: "monthly",
                day:
                  draft.kind === "recurring" && draft.cadence.kind === "monthly"
                    ? draft.cadence.day
                    : "1",
              }),
            )
          }
        >
          Monthly
        </button>
      </div>
      {draft.kind === "recurring" ? (
        <label>
          Starting date
          <input
            className="fos-input"
            type="date"
            aria-label="Starting date"
            value={draft.startsOn}
            onChange={(event) =>
              onChange({ ...draft, startsOn: event.target.value })
            }
          />
        </label>
      ) : null}
      {weekly ? (
        <fieldset className={styles.weekdayField}>
          <legend>Repeat on</legend>
          <div className={styles.weekdayChoices}>
            {WEEKDAY_OPTIONS.map(({ value, label }) => {
              const selectedDay = weekly.days.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selectedDay}
                  onClick={() => {
                    const days = selectedDay
                      ? weekly.days.filter((day) => day !== value)
                      : WEEKDAY_OPTIONS.map((option) => option.value).filter(
                          (day) => day === value || weekly.days.includes(day),
                        );
                    onChange({
                      kind: "recurring",
                      startsOn: weekly.startsOn,
                      cadence: { kind: "weekly", days },
                    });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {draft.kind === "recurring" && draft.cadence.kind === "monthly" ? (
        <label>
          Day of month
          <input
            className="fos-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={28}
            step={1}
            aria-label="Day of month"
            value={draft.cadence.day}
            onChange={(event) =>
              onChange({
                ...draft,
                cadence: { kind: "monthly", day: event.target.value },
              })
            }
          />
        </label>
      ) : null}
      {validationError ? <p role="alert">{validationError}</p> : null}
    </fieldset>
  );
}
