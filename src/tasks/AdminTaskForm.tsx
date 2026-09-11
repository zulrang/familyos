"use client";

import { type FormEvent, useState } from "react";
import { activeMembers, type HouseholdMember } from "@/members/members";
import styles from "@/shared/Admin.module.css";
import { AdminEditorScreen } from "@/shared/AdminEditorScreen";
import { adminRequest, adminRequestId } from "@/shared/admin-client";
import {
  type LocalDate,
  parseCreateTaskDraft,
  type TaskDefinition,
  type Weekday,
} from "./types";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function AdminTaskForm({
  task,
  members,
  today,
  onSaved,
  onCancel,
}: {
  task?: TaskDefinition;
  members: HouseholdMember[];
  today: LocalDate;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id] = useState(adminRequestId);
  const [title, setTitle] = useState(task?.title ?? "");
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
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });
  const roster = activeMembers(members);

  async function submit(event: FormEvent) {
    event.preventDefault();
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
    setSave({ status: "saving" });
    try {
      await adminRequest(
        "tasks",
        task
          ? { kind: "edit", task: task.id, draft }
          : { kind: "create", id, draft },
      );
      onSaved();
    } catch (error) {
      setSave({ status: "idle", error: (error as Error).message });
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
            disabled={save.status === "saving"}
            className={`${styles.form} ${styles.fields}`}
          >
            <label>
              Title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className={styles.grid}>
              <label>
                Type
                <select
                  value={type}
                  onChange={(event) =>
                    setType(
                      event.target.value === "routine" ? "routine" : "chore",
                    )
                  }
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
            {recurrence === "once" && (
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
            {recurrence === "monthly" && (
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
            {recurrence === "weekly" && (
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
            <label>
              Assignment
              <select
                value={assignment}
                onChange={(event) =>
                  setAssignment(event.target.value as typeof assignment)
                }
              >
                <option value="open">Open to anyone</option>
                <option value="fixed">One member</option>
                <option value="rotation">Take turns</option>
              </select>
            </label>
            {assignment === "fixed" && (
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
            {assignment === "rotation" && (
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
              <label>
                Time (optional)
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
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
              {save.status === "saving" ? "Saving…" : "Save task"}
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
