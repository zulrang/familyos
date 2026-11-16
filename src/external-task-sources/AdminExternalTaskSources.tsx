"use client";

import { type FormEvent, useState } from "react";
import styles from "@/shared/Admin.module.css";
import { useAdminData } from "@/shared/admin-client";
import {
  type AdminTaskSource,
  type AdminTaskSourcesRead,
  readAdminTaskSources,
  saveDefaultMember,
} from "./admin-client";

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function SourceCard({
  source,
  timeZone,
}: {
  source: AdminTaskSource;
  timeZone: string;
}) {
  const status = source.status;
  const badge =
    status.state === "enabled" || status.state === "starting"
      ? "On"
      : status.state === "halted"
        ? "Stopped"
        : "Off";
  const lines: string[] = [];
  switch (status.state) {
    case "starting":
      lines.push(
        "Starting. The first check runs shortly after FamilyOS starts.",
      );
      break;
    case "disabled":
      lines.push(
        status.reason === "not_configured"
          ? "Not set up. Add FAMILYOS_DERUPT_TOKEN to the server's .env.local and restart FamilyOS."
          : status.reason === "invalid_token"
            ? "The configured token is not valid. Check FAMILYOS_DERUPT_TOKEN and restart FamilyOS."
            : "The configured endpoint is not valid. Check FAMILYOS_DERUPT_ENDPOINT and restart FamilyOS.",
      );
      break;
    case "halted":
      lines.push(
        status.reason === "token_rejected"
          ? "Stopped: Derupt rejected the token. Put a new token in FAMILYOS_DERUPT_TOKEN and restart FamilyOS."
          : "Stopped: this connection was removed in Derupt. Add a new connection, put its token in FAMILYOS_DERUPT_TOKEN, and restart FamilyOS.",
      );
      break;
    case "enabled":
      break;
  }
  if (status.state === "enabled" || status.state === "halted") {
    lines.push(
      status.lastSuccessAt
        ? `Last successful check: ${formatTime(status.lastSuccessAt, timeZone)}`
        : "No successful check yet.",
    );
    if (status.lastProblem)
      lines.push(
        `Last problem: ${status.lastProblem.code} (${formatTime(status.lastProblem.at, timeZone)})`,
      );
  }
  return (
    <article className={styles.card} aria-label={`${source.name} status`}>
      <div className={styles.row}>
        <h2>{source.name}</h2>
        <span className={styles.badge}>{badge}</span>
      </div>
      {lines.map((line) => (
        <p key={line} className={styles.muted}>
          {line}
        </p>
      ))}
    </article>
  );
}

function DefaultMemberForm({
  data,
  onSaved,
}: {
  data: AdminTaskSourcesRead;
  onSaved: () => void;
}) {
  const current = data.members.find(
    (member) => member.id === data.defaultMember,
  );
  const usable = current?.status === "active";
  const [choice, setChoice] = useState(usable ? (current?.id ?? "") : "");
  const [save, setSave] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "error"; error: string }
  >({ status: "idle" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSave({ status: "saving" });
    try {
      await saveDefaultMember(choice || null, data.version);
      onSaved();
    } catch (error) {
      setSave({ status: "error", error: (error as Error).message });
    }
  }
  return (
    <form className={`${styles.card} ${styles.form}`} onSubmit={submit}>
      <label>
        Default member
        <select
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">No default</option>
          {data.members
            .filter((member) => member.status === "active")
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </select>
      </label>
      <p className={styles.muted}>
        Tasks that don’t name a member go to this person. A task that names an
        unknown member is refused and shows as failed in the sending app.
      </p>
      {data.defaultMember && !usable && (
        <p role="alert" className={styles.error}>
          {current
            ? `${current.name} is retired, so tasks without a member are refused. Choose another default member.`
            : "The default member no longer exists. Choose another default member."}
        </p>
      )}
      {save.status === "error" && (
        <p role="alert" className={styles.error}>
          {save.error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={save.status === "saving"}>
          {save.status === "saving" ? "Saving…" : "Save default member"}
        </button>
      </div>
    </form>
  );
}

export function AdminExternalTaskSources() {
  const { state, reload } = useAdminData(readAdminTaskSources);
  const [saved, setSaved] = useState(false);
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>Connected apps</div>
        <h1>Task sources</h1>
        <p className={styles.muted}>
          Tasks sent from other apps become assigned chores, due once.
        </p>
      </div>
      {saved && (
        <output className={styles.success}>Default member saved.</output>
      )}
      {state.status === "loading" && <output>Loading task sources…</output>}
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
          <DefaultMemberForm
            key={`${state.data.version}`}
            data={state.data}
            onSaved={() => {
              setSaved(true);
              void reload();
            }}
          />
          {state.data.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              timeZone={state.data.timeZone}
            />
          ))}
          <button
            type="button"
            className={styles.quiet}
            onClick={() => void reload()}
          >
            Refresh status
          </button>
        </>
      )}
    </div>
  );
}
