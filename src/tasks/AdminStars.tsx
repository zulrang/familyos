"use client";
import { type FormEvent, useRef, useState } from "react";
import { type HouseholdMember, memberSurface } from "@/members/members";
import styles from "@/shared/Admin.module.css";
import { AdminEditorScreen } from "@/shared/AdminEditorScreen";
import {
  adminRequest,
  adminRequestId,
  useAdminData,
} from "@/shared/admin-client";
import { Avatar } from "@/shared/ui/Avatar";
import { Icon } from "@/shared/ui/Icon";
import starsStyles from "./AdminStars.module.css";
import { readTaskAdminData } from "./admin-client";
import type { TaskAdminCommand } from "./admin-types";

export function StarAdjustmentForm({
  member,
  balance,
  onSaved,
  onCancel,
  onBusyChange,
}: {
  member: HouseholdMember;
  balance: number;
  onSaved: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [direction, setDirection] = useState<"grant" | "spend">("grant");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [save, setSave] = useState<
    | { status: "editing" }
    | { status: "saving" }
    | { status: "error"; error: string }
  >({ status: "editing" });
  const request = useRef<Extract<
    TaskAdminCommand,
    { kind: "adjust-stars" }
  > | null>(null);
  const saving = useRef(false);
  const count = Number(amount),
    after = balance + (direction === "grant" ? count : -count);
  const valid =
    Number.isSafeInteger(count) &&
    count > 0 &&
    Number.isSafeInteger(after) &&
    after >= 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !valid || !reason.trim()) return;
    if (!request.current) {
      if (
        !window.confirm(
          `${direction === "grant" ? "Grant" : "Spend"} ${count} stars for ${member.name}? Balance: ${balance} → ${after}.`,
        )
      )
        return;
      request.current = {
        kind: "adjust-stars",
        id: adminRequestId(),
        member: member.id,
        delta: direction === "grant" ? count : -count,
        reason: reason.trim(),
      };
    }
    saving.current = true;
    onBusyChange(true);
    setSave({ status: "saving" });
    try {
      await adminRequest("tasks", request.current);
      onBusyChange(false);
      onSaved();
    } catch (error) {
      setSave({
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Could not save. Retry this adjustment.",
      });
      saving.current = false;
      onBusyChange(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset
        className={starsStyles.fields}
        disabled={save.status !== "editing"}
      >
        <fieldset
          className={starsStyles.segmented}
          aria-label="Adjustment type"
        >
          {(["grant", "spend"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={direction === mode}
              onClick={() => setDirection(mode)}
            >
              {mode === "grant" ? "Grant" : "Spend"}
            </button>
          ))}
        </fieldset>
        <label>
          Number of stars
          <input
            required
            type="number"
            inputMode="numeric"
            min={1}
            max={
              direction === "spend"
                ? balance
                : Number.MAX_SAFE_INTEGER - balance
            }
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className={starsStyles.presets}>
          {[1, 3, 5].map((n) => (
            <button
              type="button"
              className={styles.quiet}
              key={n}
              disabled={
                direction === "spend"
                  ? n > balance
                  : !Number.isSafeInteger(balance + n)
              }
              onClick={() => setAmount(String(n))}
            >
              {n}
            </button>
          ))}
        </div>
        <label>
          Reason
          <textarea
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              direction === "grant"
                ? "Helping with the garden"
                : "Ice cream outing"
            }
          />
        </label>
      </fieldset>
      <div className={starsStyles.preview}>
        <span>Balance after {direction === "grant" ? "Grant" : "Spend"}</span>
        <output aria-live="polite">
          {valid ? (
            <>
              <strong>{after}</strong> stars
            </>
          ) : after < 0 ? (
            "Not enough stars"
          ) : (
            "Enter a supported whole number"
          )}
        </output>
      </div>
      {save.status === "error" && (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      )}
      <button
        type="submit"
        disabled={save.status === "saving" || !valid || !reason.trim()}
      >
        {save.status === "saving"
          ? "Saving…"
          : save.status === "error"
            ? "Retry adjustment"
            : direction === "grant"
              ? "Grant stars"
              : "Spend stars"}
      </button>
      {save.status === "error" && (
        <button type="button" className={styles.quiet} onClick={onCancel}>
          Refresh balance
        </button>
      )}
      <p className={styles.muted}>A reason is saved with each adjustment.</p>
    </form>
  );
}
export function AdminStars() {
  const { state, reload } = useAdminData(readTaskAdminData);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<"closed" | "adjusting">("closed");
  const [saving, setSaving] = useState(false);
  const member =
    state.status === "ready"
      ? (state.data.members.find((m) => m.id === selected) ??
        state.data.members[0])
      : undefined;
  function refresh() {
    setEditor("closed");
    void reload();
  }
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <h1>Manage stars</h1>
        <p className={styles.muted}>
          Grant or spend stars with a recorded reason.
        </p>
      </div>
      {notice && <output className={styles.success}>{notice}</output>}
      {state.status === "loading" && <output>Loading balances…</output>}
      {state.status === "error" && (
        <>
          <p role="alert" className={styles.error}>
            {state.error}
          </p>
          <button type="button" onClick={refresh}>
            Try again
          </button>
        </>
      )}
      {state.status === "ready" && (
        <>
          {!member && (
            <p className={styles.card}>
              Add a member first to manage their stars.
            </p>
          )}
          <section aria-label="Choose a member">
            <h2>Members</h2>
            <div className={starsStyles.members}>
              {state.data.members.map((person) => {
                const surface =
                  person.status === "active"
                    ? memberSurface(person.color)
                    : { soft: "#edf2eb", ink: "#52675d" };
                return (
                  <button
                    type="button"
                    key={person.id}
                    className={starsStyles.member}
                    disabled={saving}
                    style={{ background: surface.soft, color: surface.ink }}
                    aria-pressed={member?.id === person.id}
                    onClick={() => setSelected(person.id)}
                  >
                    <Avatar name={person.name} surface={surface} />
                    <span>
                      <strong>{person.name}</strong>
                      <span className={starsStyles.smallBalance}>
                        {state.data.tasks.balances.find(
                          (b) => b.member === person.id,
                        )?.balance ?? 0}
                        <Icon name="star" size={18} />
                      </span>
                      {person.status === "retired" && <small>Retired</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          {member && (
            <>
              <section className={styles.card}>
                <div className={styles.row}>
                  <div>
                    <h2>{member.name}</h2>
                    <p className={styles.muted}>Star Balance</p>
                  </div>
                  <span className={starsStyles.balance}>
                    {state.data.tasks.balances.find(
                      (b) => b.member === member.id,
                    )?.balance ?? 0}
                    <Icon name="star" size={32} />
                  </span>
                </div>
                <button type="button" onClick={() => setEditor("adjusting")}>
                  Adjust balance
                </button>
              </section>
              <section className={styles.card}>
                <h2>{member.name}’s Star Adjustments</h2>
                <ul className={starsStyles.history}>
                  {state.data.tasks.adjustments
                    .filter((a) => a.member === member.id)
                    .slice()
                    .reverse()
                    .map((a) => (
                      <li key={a.id}>
                        <div className={styles.row}>
                          <strong>
                            {a.delta > 0 ? "+" : ""}
                            {a.delta} stars
                          </strong>
                          <span className={styles.muted}>
                            {new Date(a.at).toLocaleString()}
                          </span>
                        </div>
                        <p>{a.reason ?? "No reason recorded"}</p>
                      </li>
                    ))}
                </ul>
                {!state.data.tasks.adjustments.some(
                  (a) => a.member === member.id,
                ) && <p className={styles.muted}>No Star Adjustments yet.</p>}
                <p className={styles.muted}>
                  Task completion corrections appear under Tasks → Completions.
                </p>
              </section>
              {editor === "adjusting" && (
                <AdminEditorScreen
                  title="Adjust stars"
                  backLabel="Stars"
                  busy={saving}
                  onBack={() => setEditor("closed")}
                >
                  <div className={styles.stack}>
                    <div className={styles.row}>
                      <h2>{member.name}</h2>
                      <span className={starsStyles.balance}>
                        {state.data.tasks.balances.find(
                          (b) => b.member === member.id,
                        )?.balance ?? 0}
                        <Icon name="star" size={32} />
                      </span>
                    </div>
                    <StarAdjustmentForm
                      key={member.id}
                      member={member}
                      onBusyChange={setSaving}
                      balance={
                        state.data.tasks.balances.find(
                          (b) => b.member === member.id,
                        )?.balance ?? 0
                      }
                      onSaved={() => {
                        setNotice("Star adjustment recorded.");
                        refresh();
                      }}
                      onCancel={refresh}
                    />
                  </div>
                </AdminEditorScreen>
              )}
            </>
          )}
          <button
            type="button"
            className={styles.quiet}
            disabled={saving}
            onClick={refresh}
          >
            Refresh balances
          </button>
        </>
      )}
    </div>
  );
}
