"use client";

import { type FormEvent, useState } from "react";
import styles from "@/shared/Admin.module.css";
import {
  adminRequest,
  adminRequestId,
  useAdminData,
} from "@/shared/admin-client";
import { readTaskAdminData } from "./admin-client";

function AdjustmentForm({
  member,
  onSaved,
  onCancel,
}: {
  member: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id] = useState(adminRequestId);
  const [direction, setDirection] = useState("grant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [save, setSave] = useState<{
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !window.confirm(
        `${direction === "grant" ? "Add" : "Subtract"} ${amount} stars? This adjustment will be recorded with your reason.`,
      )
    )
      return;
    setSave({ status: "saving" });
    try {
      await adminRequest("tasks", {
        kind: "adjust-stars",
        id,
        member,
        delta: Number(amount) * (direction === "grant" ? 1 : -1),
        reason,
      });
      onSaved();
    } catch (error) {
      setSave({ status: "idle", error: (error as Error).message });
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.grid}>
        <label>
          Adjustment
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="grant">Add stars (Grant)</option>
            <option value="spend">Subtract stars (Spend)</option>
          </select>
        </label>
        <label>
          Number of stars
          <input
            required
            type="number"
            inputMode="numeric"
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </div>
      <label>
        Reason
        <textarea
          required
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why are you adjusting this balance?"
        />
      </label>
      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={save.status === "saving"}>
          {save.status === "saving" ? "Saving…" : "Record adjustment"}
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

export function AdminStars() {
  const { state, reload } = useAdminData(readTaskAdminData);
  const [member, setMember] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>Give credit where it’s due</div>
        <h1>Stars</h1>
        <p className={styles.muted}>
          Correct balances with a recorded Grant or Spend. Balances cannot go
          below zero.
        </p>
      </div>
      {notice && <output className={styles.success}>{notice}</output>}
      {state.status === "loading" && <output>Loading balances…</output>}
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
          {!state.data.members.length && (
            <p className={styles.card}>
              Add a member first to manage their stars.
            </p>
          )}
          {state.data.members.map((person) => (
            <article className={styles.card} key={person.id}>
              <div className={styles.row}>
                <div>
                  <h2>{person.name}</h2>
                  {person.status === "retired" && (
                    <span className={styles.badge}>Retired</span>
                  )}
                </div>
                <span className={styles.balance}>
                  {state.data.tasks.balances.find(
                    (balance) => balance.member === person.id,
                  )?.balance ?? 0}{" "}
                  <span role="img" aria-label="stars">
                    ☆
                  </span>
                </span>
              </div>
              {member === person.id ? (
                <AdjustmentForm
                  member={person.id}
                  onSaved={() => {
                    setMember(null);
                    setNotice("Star adjustment recorded.");
                    void reload();
                  }}
                  onCancel={() => setMember(null)}
                />
              ) : (
                <button
                  type="button"
                  className={styles.quiet}
                  disabled={member !== null}
                  onClick={() => setMember(person.id)}
                  aria-label={`Adjust stars for ${person.name}`}
                >
                  Adjust stars
                </button>
              )}
              <details className={styles.history}>
                <summary>Adjustment history</summary>
                <ul>
                  {state.data.tasks.adjustments
                    .filter((adjustment) => adjustment.member === person.id)
                    .reverse()
                    .map((adjustment) => (
                      <li key={adjustment.id}>
                        <strong>
                          {adjustment.delta > 0 ? "+" : ""}
                          {adjustment.delta} stars
                        </strong>{" "}
                        · {new Date(adjustment.at).toLocaleString()}
                        <br />
                        {adjustment.reason ?? "No reason recorded"}
                      </li>
                    ))}
                </ul>
                <p className={styles.muted}>
                  Task completion corrections appear under Tasks → Completions.
                </p>
              </details>
            </article>
          ))}
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              if (
                !member ||
                window.confirm("Discard this unsaved adjustment and refresh?")
              ) {
                setMember(null);
                void reload();
              }
            }}
          >
            Refresh balances
          </button>
        </>
      )}
    </div>
  );
}
