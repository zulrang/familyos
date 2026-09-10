"use client";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ActiveMember } from "@/members/members";
import { memberSurface } from "@/members/members";
import { adminRequestId } from "@/shared/admin-client";
import { Avatar } from "@/shared/ui/Avatar";
import { Icon } from "@/shared/ui/Icon";
import { rewardsRequest } from "./client";
import styles from "./Rewards.module.css";
import { Stars } from "./Stars";
import type { Reward, RewardsRead } from "./types";

type Choice = {
  member: ActiveMember;
  reward: Reward;
  balance: number;
  id: string;
};
function theme(member: ActiveMember): CSSProperties {
  const surface = memberSurface(member.color);
  return {
    "--reward-soft": surface.soft,
    "--reward-ink": surface.ink,
  } as CSSProperties;
}
function SpendDialog({
  choice,
  onClose,
  onSpent,
}: {
  choice: Choice;
  onClose: () => void;
  onSpent: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [save, setSave] = useState<{
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });
  const saving = useRef(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function spend() {
    if (saving.current) return;
    saving.current = true;
    setSave({ status: "saving" });
    try {
      await rewardsRequest({
        kind: "spend",
        id: choice.id,
        member: choice.member.id,
        reward: choice.reward.id,
        revision: choice.reward.revision,
      });
      onSpent();
    } catch (error) {
      setSave({
        status: "idle",
        error:
          error instanceof Error
            ? error.message
            : "Could not connect. Try again.",
      });
      saving.current = false;
    }
  }
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={theme(choice.member)}
      aria-labelledby="spend-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving.current) onClose();
      }}
    >
      <h2 id="spend-title">{choice.member.name}’s choice</h2>
      <section className={styles.before}>
        <strong>Stars now</strong>
        <Stars count={choice.balance} literal />
      </section>
      <div className={styles.spendGroups}>
        <section>
          <Icon name={choice.reward.icon} size={40} />
          <h3>{choice.reward.name}</h3>
          <strong>These stars buy this</strong>
          <Stars count={choice.reward.cost} literal />
        </section>
        <section className={styles.keep}>
          <Avatar
            name={choice.member.name}
            surface={memberSurface(choice.member.color)}
          />
          <h3>Stars to keep</h3>
          <strong>
            {choice.balance === choice.reward.cost
              ? "All stars go to this reward"
              : "These stars stay"}
          </strong>
          <Stars count={choice.balance - choice.reward.cost} literal />
        </section>
      </div>
      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button
          type="button"
          disabled={save.status === "saving"}
          onClick={onClose}
        >
          Keep saving
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={save.status === "saving"}
          onClick={() => void spend()}
        >
          {save.status === "saving" ? "Saving…" : "Choose reward"}
        </button>
      </div>
    </dialog>
  );
}
export function RewardsScreen() {
  const [data, setData] = useState<RewardsRead | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await rewardsRequest();
      if (request === generation.current) {
        setData(next);
        setError("");
      }
    } catch (error) {
      if (request === generation.current)
        setError(
          error instanceof Error ? error.message : "Could not load rewards.",
        );
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (choice || busy) return;
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [refresh, choice, busy]);
  const member =
    data?.members.find((m) => m.id === selected) ?? data?.members[0];
  const balance = (id: string) =>
    data?.balances.find((b) => b.member === id)?.balance ?? 0;
  async function goal(reward: string | null) {
    if (!member || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    generation.current++;
    try {
      await rewardsRequest({ kind: "goal", member: member.id, reward });
      setNotice(reward ? "Goal selected." : "Goal cleared.");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save goal.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div>
          <h1>Rewards</h1>
          <p>Small efforts. Happy moments.</p>
        </div>
        <span>{data?.familyName}</span>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}{" "}
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      )}
      {notice && <output className={styles.notice}>{notice}</output>}
      {!data && !error && <p>Loading rewards…</p>}
      {data && !member && (
        <p>Add a household member in parent admin to use Rewards.</p>
      )}
      {data && member && (
        <div className={styles.layout}>
          <aside className={styles.members} aria-label="Member goal progress">
            <p>Select a member to choose a reward.</p>
            {data.members.map((m) => {
              const goalId = data.goals.find((g) => g.member === m.id)?.reward;
              const reward = data.rewards.find((r) => r.id === goalId);
              return (
                <button
                  type="button"
                  key={m.id}
                  className={styles.member}
                  style={theme(m)}
                  aria-pressed={member.id === m.id}
                  disabled={busy}
                  onClick={() => setSelected(m.id)}
                >
                  <span className={styles.memberRow}>
                    <span className={styles.identity}>
                      <Avatar name={m.name} surface={memberSurface(m.color)} />
                      <strong>{m.name}</strong>
                    </span>
                    <Stars count={balance(m.id)} />
                  </span>
                  {reward ? (
                    <span>
                      <strong>{reward.name}</strong>
                      <span
                        className={styles.progress}
                        role="progressbar"
                        aria-label={`${m.name} goal progress`}
                        aria-valuemin={0}
                        aria-valuemax={reward.cost}
                        aria-valuenow={Math.min(balance(m.id), reward.cost)}
                      >
                        <span
                          style={{
                            width: `${Math.min(100, (balance(m.id) / reward.cost) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className={styles.progressLabels}>
                        <span>
                          {balance(m.id)} / {reward.cost} stars
                        </span>
                        <span>
                          {balance(m.id) >= reward.cost
                            ? "Ready to spend"
                            : `${reward.cost - balance(m.id)} to go`}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span>No goal selected</span>
                  )}
                </button>
              );
            })}
          </aside>
          <section className={styles.choices} style={theme(member)}>
            <div className={styles.catalogHeading}>
              <div>
                <h2>Rewards for {member.name}</h2>
                <p>Spend stars now or choose a new goal.</p>
              </div>
              <div className={styles.balance}>
                <strong>{member.name}’s Star Balance</strong>
                <Stars count={balance(member.id)} />
              </div>
            </div>
            {!data.rewards.length && (
              <p>Add rewards in parent admin to start collecting.</p>
            )}
            <div className={styles.catalog}>
              {data.rewards.map((reward) => {
                const isGoal = data.goals.some(
                  (g) => g.member === member.id && g.reward === reward.id,
                );
                const affordable = balance(member.id) >= reward.cost;
                return (
                  <article
                    key={reward.id}
                    className={`${styles.reward} ${isGoal ? styles.goal : ""}`}
                  >
                    <div className={styles.rewardTop}>
                      <span className={styles.rewardIcon}>
                        <Icon name={reward.icon} size={30} />
                      </span>
                      <span className={styles.cost}>
                        {reward.cost <= 5 && <strong>{reward.cost}</strong>}
                        <Stars count={reward.cost} literal />
                      </span>
                    </div>
                    <h3>{reward.name}</h3>
                    <p>{reward.description}</p>
                    <span className={styles.availability}>
                      {affordable && <Icon name="check" />}
                      {affordable ? "Ready" : "Keep collecting"}
                    </span>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={!affordable || busy}
                        onClick={() => {
                          generation.current++;
                          setChoice({
                            member,
                            reward,
                            balance: balance(member.id),
                            id: adminRequestId(),
                          });
                        }}
                      >
                        Spend
                      </button>
                      <button
                        type="button"
                        disabled={isGoal || busy}
                        onClick={() => void goal(reward.id)}
                      >
                        {isGoal ? "Current goal" : "Set as goal"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {data.goals.some((g) => g.member === member.id) && (
              <button
                type="button"
                className={styles.clear}
                disabled={busy}
                onClick={() => void goal(null)}
              >
                Clear goal
              </button>
            )}
          </section>
        </div>
      )}
      {choice && (
        <SpendDialog
          choice={choice}
          onClose={() => {
            setChoice(null);
            void refresh();
          }}
          onSpent={() => {
            setNotice(
              `${choice.reward.name} selected for ${choice.member.name}.`,
            );
            setChoice(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
