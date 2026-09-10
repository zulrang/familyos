"use client";
import { type FormEvent, useRef, useState } from "react";
import styles from "@/shared/Admin.module.css";
import {
  adminRequest,
  adminRequestId,
  useAdminData,
} from "@/shared/admin-client";
import { Icon } from "@/shared/ui/Icon";
import {
  parseRewardDraft,
  type Reward,
  type RewardAdminCommand,
  type RewardsRead,
  rewardIcons,
} from "./types";

const readRewards = () => adminRequest<RewardsRead>("rewards");
function RewardForm({
  reward,
  onSaved,
  onCancel,
}: {
  reward: Reward | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [cost, setCost] = useState(String(reward?.cost ?? 1));
  const [icon, setIcon] = useState(reward?.icon ?? "star");
  const [save, setSave] = useState<{
    status: "editing" | "saving" | "error";
    error?: string;
  }>({ status: "editing" });
  const command = useRef<RewardAdminCommand | null>(null);
  const pending = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    const draft = parseRewardDraft({
      name,
      description,
      cost: Number(cost),
      icon,
    });
    if (!draft) return;
    command.current ??= reward
      ? { kind: "edit", id: reward.id, revision: reward.revision, draft }
      : { kind: "create", id: adminRequestId(), draft };
    pending.current = true;
    setSave({ status: "saving" });
    try {
      await adminRequest("rewards", command.current);
      onSaved();
    } catch (error) {
      setSave({
        status: "error",
        error:
          error instanceof Error ? error.message : "Could not save reward.",
      });
      pending.current = false;
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <h2>{reward ? "Edit reward" : "Add reward"}</h2>
      <fieldset className={styles.fields} disabled={save.status !== "editing"}>
        <div className={styles.stack}>
          <label>
            Name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Star cost
            <input
              required
              type="number"
              inputMode="numeric"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
          <label>
            Icon
            <select
              value={icon}
              onChange={(e) => setIcon(e.target.value as Reward["icon"])}
            >
              {rewardIcons.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={save.status === "saving"}>
          {save.status === "saving"
            ? "Saving…"
            : save.status === "error"
              ? "Retry save"
              : "Save reward"}
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
export function AdminRewards() {
  const { state, reload } = useAdminData(readRewards);
  const [editor, setEditor] = useState<{ reward: Reward | null } | null>(null);
  const [retired, setRetired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function retire(reward: Reward) {
    if (
      !window.confirm(
        `Retire ${reward.name}? It will be removed from selected goals. Previous Spends remain recorded.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await adminRequest("rewards", {
        kind: "retire",
        id: reward.id,
        revision: reward.revision,
      });
      await reload();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not retire reward.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <h1>Rewards</h1>
        <p className={styles.muted}>
          Household choices to save toward. Changes to prices update current
          goals.
        </p>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {state.status === "loading" && <output>Loading rewards…</output>}
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
      {editor ? (
        <section className={styles.card}>
          <RewardForm
            reward={editor.reward}
            onSaved={() => {
              setEditor(null);
              void reload();
            }}
            onCancel={() => {
              setEditor(null);
              void reload();
            }}
          />
        </section>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditor({ reward: null })}
        >
          Add reward
        </button>
      )}
      <label className={styles.row}>
        <span>Include retired rewards</span>
        <input
          type="checkbox"
          checked={retired}
          onChange={(e) => setRetired(e.target.checked)}
        />
      </label>
      {state.status === "ready" && (
        <>
          {!state.data.rewards.length && (
            <p className={styles.card}>
              Add the first reward for the household.
            </p>
          )}
          {state.data.rewards
            .filter((r) => retired || !r.retiredAt)
            .map((r) => (
              <article className={styles.card} key={r.id}>
                <div className={styles.row}>
                  <h2>{r.name}</h2>
                  <span className={styles.row}>
                    <Icon name={r.icon} />
                    <strong>{r.cost} stars</strong>
                  </span>
                </div>
                <p>{r.description}</p>
                {r.retiredAt ? (
                  <span className={styles.badge}>Retired</span>
                ) : (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={!!editor || busy}
                      onClick={() => setEditor({ reward: r })}
                    >
                      Edit reward
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={!!editor || busy}
                      onClick={() => void retire(r)}
                    >
                      Retire reward
                    </button>
                  </div>
                )}
              </article>
            ))}
        </>
      )}
      {!editor && (
        <button
          type="button"
          className={styles.quiet}
          disabled={busy}
          onClick={() => void reload()}
        >
          Refresh rewards
        </button>
      )}
    </div>
  );
}
