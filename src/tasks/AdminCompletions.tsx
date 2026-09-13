"use client";

import { type FormEvent, useRef, useState } from "react";
import type { HouseholdMember } from "@/members/members";
import styles from "@/shared/Admin.module.css";
import { adminRequest, adminRequestId } from "@/shared/admin-client";
import type { TaskAdminRead } from "./admin-types";
import type { ClaimedBounty, TaskEvent } from "./types";

function CorrectionForm({
  event,
  data,
  members,
  onSaved,
  onCancel,
}: {
  event: Extract<TaskEvent, { kind: "completed" | "verified" }>;
  data: TaskAdminRead;
  members: HouseholdMember[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const previous = data.corrections
    .filter((row) => row.task === event.task && row.window === event.window)
    .at(-1);
  const [id] = useState(adminRequestId);
  const [by, setBy] = useState(previous ? (previous.by ?? "") : event.by);
  const [reason, setReason] = useState("");
  const [save, setSave] = useState<{
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });
  async function submit(submission: FormEvent) {
    submission.preventDefault();
    if (
      !window.confirm(
        "Record this completion correction? Its original star credit will be reversed or transferred, and the original history will stay.",
      )
    )
      return;
    setSave({ status: "saving" });
    try {
      await adminRequest("tasks", {
        kind: "correct",
        id,
        task: event.task,
        window: event.window,
        by: by || null,
        previous: previous?.id ?? null,
        reason,
      });
      onSaved();
    } catch (error) {
      setSave({ status: "idle", error: (error as Error).message });
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        Correct outcome
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">Not completed</option>
          {members.map((member) => (
            <option value={member.id} key={member.id}>
              Completed by {member.name}
              {member.status === "retired" ? " (retired)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <textarea
          required
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What needs correcting?"
        />
      </label>
      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={save.status === "saving"}>
          {save.status === "saving" ? "Saving…" : "Record correction"}
        </button>
        <button
          type="button"
          className={styles.quiet}
          disabled={save.status === "saving"}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

type CorrectableBounty = ClaimedBounty & {
  state: Extract<ClaimedBounty["state"], { kind: "completed" | "reopened" }>;
};

function BountyCorrectionForm({
  row,
  members,
  onSaved,
  onCancel,
}: {
  row: CorrectableBounty;
  members: HouseholdMember[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const state = row.state;
  const completed = state.kind === "completed";
  const completion =
    state.kind === "completed" ? state.completion : state.undoneCompletion;
  const [requestId] = useState(adminRequestId);
  const [action, setAction] = useState<"undo" | "restore" | "reassign">(
    completed ? "undo" : "restore",
  );
  const [member, setMember] = useState(
    state.kind === "completed" ? state.creditedTo : row.claim.member,
  );
  const [reason, setReason] = useState("");
  const pending = useRef(false);
  const [save, setSave] = useState<{
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });

  async function submit(submission: FormEvent) {
    submission.preventDefault();
    if (pending.current) return;
    if (
      !window.confirm(
        "Record this Bounty completion correction? Star Balance changes and correction history will be saved together.",
      )
    )
      return;
    pending.current = true;
    setSave({ status: "saving" });
    try {
      await adminRequest("tasks", {
        kind: `${action}-bounty-completion`,
        requestId,
        claim: row.claim.id,
        revision: row.revision,
        completion: completion.id,
        predecessor: row.state.correction,
        ...(action === "reassign" ? { member } : {}),
        reason,
      });
      onSaved();
    } catch (error) {
      pending.current = false;
      setSave({ status: "idle", error: (error as Error).message });
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        Correction
        <select
          value={action}
          disabled={save.status === "saving"}
          onChange={(event) =>
            setAction(event.target.value as "undo" | "restore" | "reassign")
          }
        >
          {completed ? (
            <>
              <option value="undo">Undo completion</option>
              <option value="reassign">Reassign credit</option>
            </>
          ) : (
            <option value="restore">Restore completion</option>
          )}
        </select>
      </label>
      {action === "reassign" ? (
        <label>
          Credit to
          <select
            value={member}
            disabled={save.status === "saving"}
            onChange={(event) => setMember(event.target.value)}
          >
            {members.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.name}
                {candidate.status === "retired" ? " (retired)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Reason
        <textarea
          required
          maxLength={1000}
          value={reason}
          disabled={save.status === "saving"}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What needs correcting?"
        />
      </label>
      {save.error ? (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="submit" disabled={save.status === "saving"}>
          {save.status === "saving" ? "Saving…" : "Record Bounty correction"}
        </button>
        <button
          type="button"
          className={styles.quiet}
          disabled={save.status === "saving"}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AdminCompletions({
  data,
  members,
  query,
  onSaved,
}: {
  data: TaskAdminRead;
  members: HouseholdMember[];
  query: string;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const completions = data.originalEvents
    .filter((event) => event.kind === "completed")
    .sort((a, b) => b.at.localeCompare(a.at));
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name ?? id;
  const rows = completions.map((event) => {
    const history = data.corrections.filter(
      (row) => row.task === event.task && row.window === event.window,
    );
    const latest = history.at(-1);
    return { event, history, by: latest ? latest.by : event.by };
  });
  const visible = rows.filter(({ event, by }) =>
    `${data.definitions.find((row) => row.id === event.task)?.title ?? "Task"} ${
      by ? name(by) : "undone"
    } ${name(event.by)} ${event.window}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const bountyRows = data.bountyClaims
    .filter((row) =>
      data.bountyCompletions.some(
        (completion) => completion.claim === row.claim.id,
      ),
    )
    .filter((row) => {
      const memberNames = data.bountyCompletionCorrections.flatMap(
        (correction) =>
          correction.claim === row.claim.id
            ? [correction.fromMember, correction.toMember]
                .filter((member): member is string => member !== null)
                .map(name)
            : [],
      );
      return `${row.claim.title} ${row.claim.scheduledOn} ${name(
        row.claim.member,
      )} ${memberNames.join(" ")} ${row.state.kind}`
        .toLowerCase()
        .includes(query.toLowerCase());
    });
  return (
    <div className={styles.cards}>
      <p className={styles.muted}>
        Correct who completed a task, undo a mistaken completion, or restore it.
        History is never deleted.
      </p>
      {!visible.length && !bountyRows.length && (
        <p className={styles.card}>No matching completions.</p>
      )}
      {visible.map(({ event, history, by }) => {
        const key = `${event.task}:${event.window}`;
        return (
          <article className={styles.card} key={key}>
            <h2>
              {data.definitions.find((row) => row.id === event.task)?.title ??
                "Historical task"}
            </h2>
            <p className={styles.muted}>
              Window: {event.window}
              <br />
              {by ? `Completed by ${name(by)}` : "Completion undone"}
            </p>
            {selected === key ? (
              <CorrectionForm
                event={event}
                data={data}
                members={members}
                onSaved={() => {
                  setSelected(null);
                  onSaved();
                }}
                onCancel={() => setSelected(null)}
              />
            ) : (
              <button
                type="button"
                className={styles.quiet}
                disabled={selected !== null}
                onClick={() => setSelected(key)}
              >
                Correct completion
              </button>
            )}
            <details className={styles.history}>
              <summary>
                Original record
                {history.length
                  ? ` + ${history.length} correction${history.length === 1 ? "" : "s"}`
                  : ""}
              </summary>
              <ul>
                <li>
                  Completed by {name(event.by)} ·{" "}
                  {new Date(event.at).toLocaleString()}
                </li>
                {history.map((correction) => (
                  <li key={correction.id}>
                    {correction.by
                      ? `Completed by ${name(correction.by)}`
                      : "Completion undone"}{" "}
                    · {new Date(correction.at).toLocaleString()}
                    <br />
                    {correction.reason}
                  </li>
                ))}
              </ul>
            </details>
          </article>
        );
      })}
      {bountyRows.map((row) => {
        const key = `bounty:${row.claim.id}`;
        const completions = data.bountyCompletions.filter(
          (completion) => completion.claim === row.claim.id,
        );
        const history = data.bountyCompletionCorrections.filter(
          (correction) => correction.claim === row.claim.id,
        );
        const correctable =
          row.state.kind === "completed" || row.state.kind === "reopened";
        return (
          <article className={styles.card} key={key}>
            <h2>{row.claim.title}</h2>
            <p className={styles.muted}>
              Bounty accepted for {row.claim.scheduledOn}
              <br />
              {row.state.kind === "completed"
                ? `Completed by ${name(row.state.creditedTo)} · ${row.state.completion.creditedStars} Stars`
                : row.state.kind === "reopened"
                  ? "Completion undone · work reopened"
                  : "Completion undone · claim released"}
            </p>
            {selected === key && correctable ? (
              <BountyCorrectionForm
                row={row as CorrectableBounty}
                members={members}
                onSaved={() => {
                  setSelected(null);
                  onSaved();
                }}
                onCancel={() => setSelected(null)}
              />
            ) : correctable ? (
              <button
                type="button"
                className={styles.quiet}
                disabled={selected !== null}
                onClick={() => setSelected(key)}
              >
                Correct Bounty completion
              </button>
            ) : null}
            <details className={styles.history}>
              <summary>
                {completions.length} completion
                {completions.length === 1 ? "" : "s"} + {history.length}{" "}
                correction{history.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {completions.map((completion) => (
                  <li key={completion.id}>
                    Completed by {name(completion.by)} for{" "}
                    {completion.creditedStars} Stars ·{" "}
                    {new Date(completion.at).toLocaleString()}
                  </li>
                ))}
                {history.map((correction) => (
                  <li key={correction.id}>
                    {correction.kind === "undo"
                      ? `Undone from ${name(correction.fromMember ?? "unknown")}`
                      : correction.kind === "restore"
                        ? `Restored to ${name(correction.toMember ?? "unknown")}`
                        : `Reassigned from ${name(correction.fromMember ?? "unknown")} to ${name(correction.toMember ?? "unknown")}`}{" "}
                    · {correction.creditedStars} Stars ·{" "}
                    {new Date(correction.at).toLocaleString()}
                    <br />
                    {correction.reason}
                  </li>
                ))}
              </ul>
            </details>
          </article>
        );
      })}
    </div>
  );
}
