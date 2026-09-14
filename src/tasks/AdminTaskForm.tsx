"use client";

import { type FormEvent, useRef, useState } from "react";
import { activeMembers, type HouseholdMember } from "@/members/members";
import styles from "@/shared/Admin.module.css";
import { AdminEditorScreen } from "@/shared/AdminEditorScreen";
import { adminRequest, adminRequestId } from "@/shared/admin-client";
import type { TaskAdminCommand } from "./admin-types";
import {
  type BountyRecurrenceDraft,
  BountyRecurrenceEditor,
  parseBountyRecurrenceDraft,
} from "./BountyRecurrenceEditor";
import {
  type LegacyTaskDefinition,
  type LocalDate,
  parseBountyCommandId,
  parseCreateTaskDraft,
  parseTaskCreateDraft,
  type Weekday,
} from "./types";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function initialBountyRecurrence(
  task: LegacyTaskDefinition | undefined,
  today: LocalDate,
): BountyRecurrenceDraft {
  if (!task || task.recurrence.kind === "once") return { kind: "once" };
  const recurrence = task.recurrence;
  return {
    kind: "recurring",
    startsOn: today,
    cadence:
      recurrence.kind === "monthly"
        ? { kind: "monthly", day: String(recurrence.day) }
        : recurrence.kind === "weekly"
          ? { kind: "weekly", days: recurrence.days }
          : { kind: "daily" },
  };
}

export function AdminTaskForm({
  task,
  members,
  today,
  onSaved,
  onCancel,
}: {
  task?: LegacyTaskDefinition;
  members: HouseholdMember[];
  today: LocalDate;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id] = useState(adminRequestId);
  const [replacementRequestId] = useState(() => {
    const parsed = parseBountyCommandId(id);
    if (!parsed) throw new Error("Could not create a task request identity.");
    return parsed;
  });
  const [title, setTitle] = useState(task?.title ?? "");
  const [workMode, setWorkMode] = useState<"assigned" | "bounty">("assigned");
  const [bountyRecurrence, setBountyRecurrence] =
    useState<BountyRecurrenceDraft>(() => initialBountyRecurrence(task, today));
  const [type, setType] = useState(task?.type ?? "chore");
  const [recurrence, setRecurrence] = useState(
    task?.recurrence.kind ?? "daily",
  );
  const [date, setDate] = useState<string>(
    task?.recurrence.kind === "once" ? task.recurrence.date : today,
  );
  const [day, setDay] = useState(
    task?.recurrence.kind === "monthly" ? String(task.recurrence.day) : "1",
  );
  const [days, setDays] = useState<Weekday[]>(
    task?.recurrence.kind === "weekly" ? task.recurrence.days : ["mon"],
  );
  const [assignment, setAssignment] = useState(task?.assignment.kind ?? "open");
  const [member, setMember] = useState(
    task?.assignment.kind === "fixed" ? task.assignment.member : "",
  );
  const [order, setOrder] = useState<string[]>(
    task?.assignment.kind === "rotation" ? task.assignment.order : [],
  );
  const [time, setTime] = useState(task?.time ?? "");
  const [stars, setStars] = useState(String(task?.stars ?? 0));
  const [save, setSave] = useState<{
    status: "idle" | "saving" | "retry";
    error?: string;
  }>({ status: "idle" });
  const saving = useRef(false);
  const command = useRef<TaskAdminCommand | null>(null);
  const roster = activeMembers(members);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    if (task && workMode === "bounty") {
      const bountySchedule = parseBountyRecurrenceDraft(bountyRecurrence);
      const bountyDraft = bountySchedule
        ? parseTaskCreateDraft({
            kind: "bounty",
            type: "chore",
            title,
            stars: Number(stars),
            recurrence: bountySchedule,
          })
        : null;
      if (!bountyDraft || bountyDraft.kind !== "bounty") {
        setSave({
          status: "idle",
          error:
            "Enter a title, valid Bounty schedule, and nonnegative whole-number Star reward.",
        });
        return;
      }
      command.current ??= {
        kind: "replace-definition",
        requestId: replacementRequestId,
        source: { kind: "assigned", definition: task.id },
        replacement: bountyDraft,
      };
      saving.current = true;
      setSave({ status: "saving" });
      try {
        await adminRequest("tasks", command.current);
        onSaved();
      } catch (error) {
        setSave({ status: "retry", error: (error as Error).message });
      } finally {
        saving.current = false;
      }
      return;
    }
    const draft = parseCreateTaskDraft({
      title,
      type,
      time,
      stars: Number(stars),
      recurrence:
        recurrence === "once"
          ? { kind: recurrence, date }
          : recurrence === "weekly"
            ? { kind: recurrence, days }
            : recurrence === "monthly"
              ? { kind: recurrence, day: Number(day) }
              : { kind: recurrence },
      assignment:
        assignment === "fixed"
          ? { kind: assignment, member }
          : assignment === "rotation"
            ? { kind: assignment, order }
            : { kind: assignment },
    });
    if (!draft) {
      setSave({
        status: "idle",
        error:
          "Check the schedule, assignment, and star value. Choose at least one day for a weekly task and one member for a rotation.",
      });
      return;
    }
    command.current ??= task
      ? { kind: "edit", task: task.id, draft }
      : { kind: "create", id, draft };
    saving.current = true;
    setSave({ status: "saving" });
    try {
      await adminRequest("tasks", command.current);
      onSaved();
    } catch (error) {
      setSave({ status: "retry", error: (error as Error).message });
    } finally {
      saving.current = false;
    }
  }
  return (
    <AdminEditorScreen
      title={task ? "Edit task" : "New task"}
      backLabel="Tasks"
      onBack={onCancel}
      busy={save.status === "saving"}
    >
      {(close) => (
        <form className={`${styles.card} ${styles.form}`} onSubmit={submit}>
          <fieldset
            disabled={save.status !== "idle"}
            className={`${styles.form} ${styles.fields}`}
          >
            {task?.type === "chore" ? (
              <label>
                Work mode
                <select
                  value={workMode}
                  onChange={(event) =>
                    setWorkMode(
                      event.target.value === "bounty" ? "bounty" : "assigned",
                    )
                  }
                >
                  <option value="assigned">Assigned Chore</option>
                  <option value="bounty">Bounty</option>
                </select>
              </label>
            ) : null}
            <label>
              Title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {workMode === "bounty" ? (
              <BountyRecurrenceEditor
                draft={bountyRecurrence}
                defaultStartsOn={today}
                onChange={setBountyRecurrence}
              />
            ) : null}
            {workMode === "assigned" ? (
              <div className={styles.grid}>
                <label>
                  Type
                  <select
                    value={type}
                    onChange={(event) => {
                      const next =
                        event.target.value === "routine" ? "routine" : "chore";
                      setType(next);
                      if (next === "routine" && assignment === "open") {
                        setAssignment("fixed");
                      }
                    }}
                  >
                    <option value="chore">Chore</option>
                    <option value="routine">Routine</option>
                  </select>
                </label>
                <label>
                  Repeat
                  <select
                    value={recurrence}
                    onChange={(event) =>
                      setRecurrence(event.target.value as typeof recurrence)
                    }
                  >
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </div>
            ) : null}
            {workMode === "assigned" && recurrence === "once" && (
              <label>
                Date
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
            )}
            {workMode === "assigned" && recurrence === "monthly" && (
              <label>
                Day of month (1–28)
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={28}
                  required
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                />
              </label>
            )}
            {workMode === "assigned" && recurrence === "weekly" && (
              <fieldset>
                <legend>Days</legend>
                <div className={styles.grid}>
                  {WEEKDAYS.map((weekday) => (
                    <label className={styles.check} key={weekday}>
                      <input
                        type="checkbox"
                        checked={days.includes(weekday)}
                        onChange={(event) =>
                          setDays(
                            event.target.checked
                              ? WEEKDAYS.filter(
                                  (value) =>
                                    value === weekday || days.includes(value),
                                )
                              : days.filter((value) => value !== weekday),
                          )
                        }
                      />
                      {weekday[0].toUpperCase() + weekday.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {workMode === "assigned" ? (
              <label>
                Assignment
                <select
                  value={assignment}
                  onChange={(event) =>
                    setAssignment(event.target.value as typeof assignment)
                  }
                >
                  {type === "chore" ||
                  (assignment === "open" && task?.type === "routine") ? (
                    <option value="open">Open to anyone</option>
                  ) : null}
                  <option value="fixed">One member</option>
                  <option value="rotation">Take turns</option>
                </select>
              </label>
            ) : null}
            {workMode === "assigned" && assignment === "fixed" && (
              <label>
                Member
                <select
                  required
                  value={member}
                  onChange={(event) => setMember(event.target.value)}
                >
                  <option value="">Choose a member</option>
                  {roster.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {workMode === "assigned" && assignment === "rotation" && (
              <fieldset className={styles.stack}>
                <legend>Rotation order</legend>
                <p className={styles.muted}>
                  Add members in turn order. Existing rotations keep the next
                  person’s turn when saved.
                </p>
                {order.map((personId, index) => (
                  <div className={styles.row} key={personId}>
                    <span>
                      {index + 1}.{" "}
                      {members.find((person) => person.id === personId)?.name ??
                        personId}
                    </span>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.quiet}
                        disabled={index === 0}
                        aria-label={`Move ${members.find((person) => person.id === personId)?.name ?? personId} earlier`}
                        onClick={() => {
                          const next = [...order];
                          [next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ];
                          setOrder(next);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.quiet}
                        onClick={() =>
                          setOrder(order.filter((value) => value !== personId))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <label>
                  Add to rotation
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value)
                        setOrder([...order, event.target.value]);
                    }}
                  >
                    <option value="">Choose a member</option>
                    {roster
                      .filter((person) => !order.includes(person.id))
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                </label>
              </fieldset>
            )}
            <div className={styles.grid}>
              {workMode === "assigned" ? (
                <label>
                  Time (optional)
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                </label>
              ) : null}
              <label>
                Stars per completion
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  max={Number.MAX_SAFE_INTEGER}
                  required
                  value={stars}
                  onChange={(event) => setStars(event.target.value)}
                />
              </label>
            </div>
          </fieldset>
          {task && (
            <p className={styles.muted}>
              Changes to the schedule or assignment start a new task version.
              Past completions and earned stars stay intact.
            </p>
          )}
          {save.error && (
            <p role="alert" className={styles.error}>
              {save.error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" disabled={save.status === "saving"}>
              {save.status === "saving"
                ? "Saving…"
                : save.status === "retry"
                  ? "Retry save"
                  : "Save task"}
            </button>
            <button
              type="button"
              className={styles.quiet}
              disabled={save.status === "saving"}
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </AdminEditorScreen>
  );
}
