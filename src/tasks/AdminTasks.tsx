"use client";

import { useState } from "react";
import styles from "@/shared/Admin.module.css";
import { adminRequest, useAdminData } from "@/shared/admin-client";
import { AdminCompletions } from "./AdminCompletions";
import { AdminTaskForm } from "./AdminTaskForm";
import { readTaskAdminData } from "./admin-client";
import type { LegacyTaskDefinition, LocalDate, TaskType } from "./types";

type TaskDefinitionFilters = Readonly<{
  query: string;
  member: string | null;
  type: TaskType | null;
  includeRetired: boolean;
  includePastOneTime: boolean;
}>;

function isAssignedTo(task: LegacyTaskDefinition, member: string): boolean {
  if (task.assignment.kind === "fixed") {
    return task.assignment.member === member;
  }
  if (task.assignment.kind === "rotation") {
    return task.assignment.order.includes(member);
  }
  return false;
}

function taskTypeFilter(value: string): TaskType | null {
  return value === "chore" || value === "routine" ? value : null;
}

function filterTaskDefinitions(
  definitions: LegacyTaskDefinition[],
  today: LocalDate,
  filters: TaskDefinitionFilters,
): LegacyTaskDefinition[] {
  const query = filters.query.trim().toLowerCase();
  return definitions.filter((task) => {
    if (!filters.includeRetired && task.retiredAt !== null) return false;
    if (
      !filters.includePastOneTime &&
      task.recurrence.kind === "once" &&
      task.recurrence.date < today
    ) {
      return false;
    }
    if (filters.member && !isAssignedTo(task, filters.member)) return false;
    if (filters.type && task.type !== filters.type) return false;
    return task.title.toLowerCase().includes(query);
  });
}

export function AdminTasks() {
  const { state, reload } = useAdminData(readTaskAdminData);
  const [section, setSection] = useState<"definitions" | "completions">(
    "definitions",
  );
  const [editor, setEditor] = useState<
    { kind: "new" } | { kind: "edit"; task: LegacyTaskDefinition } | null
  >(null);
  const [query, setQuery] = useState("");
  const [member, setMember] = useState<string | null>(null);
  const [type, setType] = useState<TaskType | null>(null);
  const [retired, setRetired] = useState(false);
  const [pastOneTime, setPastOneTime] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const visibleDefinitions =
    state.status === "ready"
      ? filterTaskDefinitions(
          state.data.tasks.definitions,
          state.data.tasks.today,
          {
            query,
            member,
            type,
            includeRetired: retired,
            includePastOneTime: pastOneTime,
          },
        )
      : [];
  function saved(message: string) {
    setEditor(null);
    setNotice({ kind: "success", message });
    void reload();
  }
  async function retire(task: LegacyTaskDefinition) {
    if (
      !window.confirm(
        `Retire “${task.title}”? It will leave the task board. Its history and earned stars will stay.`,
      )
    )
      return;
    setRetiring(task.id);
    setNotice(null);
    try {
      await adminRequest("tasks", { kind: "retire", task: task.id });
      saved("Task retired. History preserved.");
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    } finally {
      setRetiring(null);
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>The everyday things</div>
        <h1>Tasks</h1>
        <p className={styles.muted}>
          Routines and responsibilities, shared fairly.
        </p>
      </div>
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={styles[notice.kind]}
        >
          {notice.message}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={section === "definitions" ? undefined : styles.quiet}
          aria-pressed={section === "definitions"}
          onClick={() => setSection("definitions")}
        >
          Manage tasks
        </button>
        <button
          type="button"
          className={section === "completions" ? undefined : styles.quiet}
          aria-pressed={section === "completions"}
          onClick={() => setSection("completions")}
        >
          Completions
        </button>
      </div>
      <div className={styles.form}>
        <label>
          Search
          <input
            type="search"
            placeholder={
              section === "definitions"
                ? "Find a task…"
                : "Task, member, or window date…"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {state.status === "loading" && <output>Loading tasks…</output>}
      {state.status === "error" && (
        <>
          <p role="alert" className={styles.error}>
            {state.error}
          </p>
          <button type="button" onClick={() => void reload()}>
            Try again
          </button>
        </>
      )}
      {state.status === "ready" && (
        <>
          {section === "completions" ? (
            <AdminCompletions
              data={state.data.tasks}
              members={state.data.members}
              query={query}
              onSaved={() =>
                saved("Completion corrected. Original history preserved.")
              }
            />
          ) : (
            <>
              <button type="button" onClick={() => setEditor({ kind: "new" })}>
                New task
              </button>
              <div className={styles.form}>
                <div className={styles.grid}>
                  <label>
                    Household member
                    <select
                      value={member ?? ""}
                      onChange={(event) =>
                        setMember(event.target.value || null)
                      }
                    >
                      <option value="">All members</option>
                      {state.data.members.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                          {person.status === "retired" ? " (retired)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      value={type ?? ""}
                      onChange={(event) =>
                        setType(taskTypeFilter(event.target.value))
                      }
                    >
                      <option value="">All types</option>
                      <option value="chore">Chore</option>
                      <option value="routine">Routine</option>
                    </select>
                  </label>
                </div>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={pastOneTime}
                    onChange={(event) => setPastOneTime(event.target.checked)}
                  />
                  Include past one-time tasks
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={retired}
                    onChange={(event) => setRetired(event.target.checked)}
                  />
                  Include retired tasks and old versions
                </label>
              </div>
              {visibleDefinitions.length === 0 && (
                <p className={styles.card}>
                  No matching tasks. Create one to get started.
                </p>
              )}
              {visibleDefinitions.map((task) => {
                const name = (id: string) =>
                  state.data.members.find((person) => person.id === id)?.name ??
                  id;
                const assignment =
                  task.assignment.kind === "open"
                    ? "Open to anyone"
                    : task.assignment.kind === "fixed"
                      ? name(task.assignment.member)
                      : `Turns: ${task.assignment.order.map(name).join(" → ")}`;
                const recurrence =
                  task.recurrence.kind === "once"
                    ? task.recurrence.date
                    : task.recurrence.kind === "weekly"
                      ? task.recurrence.days.join(", ")
                      : task.recurrence.kind === "monthly"
                        ? `Monthly, day ${task.recurrence.day}`
                        : "Daily";
                return (
                  <article key={task.id} className={styles.card}>
                    <div className={styles.row}>
                      <h2>{task.title}</h2>
                      <span className={styles.badge}>
                        {task.retiredAt
                          ? "Retired"
                          : task.type === "chore"
                            ? "Chore"
                            : "Routine"}
                      </span>
                    </div>
                    <p className={styles.muted}>
                      {recurrence}
                      {task.time ? ` · ${task.time}` : ""}
                      <br />
                      {assignment}
                      <br />
                      {task.stars} stars per completion
                    </p>
                    {task.retiredAt ? (
                      <p className={styles.muted}>
                        Retired {task.retiredAt}. History preserved.
                      </p>
                    ) : (
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.quiet}
                          aria-label={`Edit ${task.title}`}
                          disabled={!!retiring}
                          onClick={() => setEditor({ kind: "edit", task })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          disabled={!!retiring}
                          aria-label={`Retire ${task.title}`}
                          onClick={() => void retire(task)}
                        >
                          {retiring === task.id ? "Retiring…" : "Retire"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </>
          )}
          <button
            type="button"
            className={styles.quiet}
            onClick={() => void reload()}
          >
            Refresh tasks
          </button>
        </>
      )}
      {editor && state.status === "ready" && (
        <AdminTaskForm
          key={editor.kind === "new" ? "new" : editor.task.id}
          task={editor.kind === "edit" ? editor.task : undefined}
          members={state.data.members}
          today={state.data.tasks.today}
          onSaved={() => saved("Task saved.")}
          onCancel={() => setEditor(null)}
        />
      )}
    </div>
  );
}
