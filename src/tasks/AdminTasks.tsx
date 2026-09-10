"use client";

import { useState } from "react";
import styles from "@/shared/Admin.module.css";
import { adminRequest, useAdminData } from "@/shared/admin-client";
import { AdminCompletions } from "./AdminCompletions";
import { AdminTaskForm } from "./AdminTaskForm";
import { readTaskAdminData } from "./admin-client";
import type { TaskDefinition } from "./types";

export function AdminTasks() {
  const { state, reload } = useAdminData(readTaskAdminData);
  const [section, setSection] = useState<"definitions" | "completions">(
    "definitions",
  );
  const [editor, setEditor] = useState<
    { kind: "new" } | { kind: "edit"; task: TaskDefinition } | null
  >(null);
  const [query, setQuery] = useState("");
  const [retired, setRetired] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  function saved(message: string) {
    setEditor(null);
    setNotice({ kind: "success", message });
    void reload();
  }
  async function retire(task: TaskDefinition) {
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
          disabled={!!editor}
          onClick={() => setSection("definitions")}
        >
          Manage tasks
        </button>
        <button
          type="button"
          className={section === "completions" ? undefined : styles.quiet}
          aria-pressed={section === "completions"}
          disabled={!!editor}
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
              {editor ? (
                <AdminTaskForm
                  key={editor.kind === "new" ? "new" : editor.task.id}
                  task={editor.kind === "edit" ? editor.task : undefined}
                  members={state.data.members}
                  today={state.data.tasks.today}
                  onSaved={() => saved("Task saved.")}
                  onCancel={() => setEditor(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditor({ kind: "new" })}
                >
                  New task
                </button>
              )}
              <div className={styles.form}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={retired}
                    onChange={(event) => setRetired(event.target.checked)}
                  />
                  Include retired tasks and old versions
                </label>
              </div>
              {!state.data.tasks.definitions.some(
                (task) =>
                  (retired || task.retiredAt === null) &&
                  task.title.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <p className={styles.card}>
                  No matching tasks. Create one to get started.
                </p>
              )}
              {state.data.tasks.definitions
                .filter(
                  (task) =>
                    (retired || task.retiredAt === null) &&
                    task.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((task) => {
                  const name = (id: string) =>
                    state.data.members.find((person) => person.id === id)
                      ?.name ?? id;
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
                            disabled={!!editor || !!retiring}
                            onClick={() => setEditor({ kind: "edit", task })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={!!editor || !!retiring}
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
            onClick={() => {
              if (
                !editor ||
                window.confirm("Discard this unsaved task edit and refresh?")
              ) {
                setEditor(null);
                void reload();
              }
            }}
          >
            Refresh tasks
          </button>
        </>
      )}
    </div>
  );
}
