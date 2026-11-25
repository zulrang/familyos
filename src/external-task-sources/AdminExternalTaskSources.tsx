"use client";

import { type FormEvent, useState } from "react";
import styles from "@/shared/Admin.module.css";
import { useAdminData } from "@/shared/admin-client";
import {
  type AdminTaskSource,
  type AdminTaskSourcesRead,
  clearDeruptToken,
  readAdminTaskSources,
  saveDefaultMember,
  saveDeruptToken,
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

const ENV_TOKEN = "FAMILYOS_DERUPT_TOKEN";

function statusLine(source: AdminTaskSource): string | null {
  const { status, token } = source;
  switch (status.state) {
    case "starting":
      return "Starting. The first check runs in a moment.";
    case "disabled":
      if (status.reason === "not_configured")
        return "Not set up. Paste a connection token from Derupt to turn it on.";
      if (status.reason === "invalid_token")
        return token.source === "environment"
          ? `${ENV_TOKEN} on the server is not a valid token. Save a token here to use instead.`
          : "The saved token is not valid. Replace it with the token Derupt shows.";
      return "The configured endpoint is not valid. Check FAMILYOS_DERUPT_ENDPOINT and restart FamilyOS.";
    case "halted":
      return status.reason === "token_rejected"
        ? "Stopped: Derupt rejected the token. Save a new token to resume."
        : "Stopped: this connection was removed in Derupt. Add a new connection there and save its token here.";
    case "enabled":
      return null;
  }
}

function tokenLine(token: AdminTaskSource["token"]): string | null {
  const ending = token.ending ? ` (ends in ••••${token.ending})` : "";
  if (token.source === "saved")
    return token.environmentSet
      ? `Using the token saved here${ending}. ${ENV_TOKEN} is also set on the server; FamilyOS uses it if you clear this one.`
      : `Using the token saved here${ending}.`;
  if (token.source === "environment")
    return `Using ${ENV_TOKEN} from the server${ending}. A token saved here takes its place.`;
  return null;
}

type TokenChange =
  | { status: "idle" }
  | { status: "confirmClear" }
  | { status: "saving" }
  | { status: "error"; error: string };

function TokenForm({
  token,
  onChanged,
}: {
  token: AdminTaskSource["token"];
  onChanged: (notice: string) => void;
}) {
  const [value, setValue] = useState("");
  const [change, setChange] = useState<TokenChange>({ status: "idle" });
  const busy = change.status === "saving";
  async function run(action: () => Promise<unknown>, notice: string) {
    setChange({ status: "saving" });
    try {
      await action();
      setValue("");
      setChange({ status: "idle" });
      onChanged(notice);
    } catch (error) {
      setChange({ status: "error", error: (error as Error).message });
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => saveDeruptToken(value), "Derupt token saved.");
  }
  const saved = token.source === "saved";
  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        {saved ? "New connection token" : "Connection token"}
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className={styles.muted}>
        In Derupt, open Settings → Connections → Add, turn on the Task kind, and
        copy the token it shows. It takes effect right away.
      </p>
      {change.status === "error" && (
        <p role="alert" className={styles.error}>
          {change.error}
        </p>
      )}
      {change.status === "confirmClear" ? (
        <>
          <p role="alert" className={styles.muted}>
            {token.environmentSet
              ? `Clear the saved token? FamilyOS goes back to ${ENV_TOKEN} from the server.`
              : "Clear the saved token? Tasks from Derupt stop arriving."}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.quiet}
              onClick={() => setChange({ status: "idle" })}
            >
              Keep token
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() =>
                void run(clearDeruptToken, "Derupt token cleared.")
              }
            >
              Clear token
            </button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          {saved && (
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => setChange({ status: "confirmClear" })}
            >
              Clear token
            </button>
          )}
          <button type="submit" disabled={busy || !value.trim()}>
            {busy ? "Saving…" : saved ? "Replace token" : "Save token"}
          </button>
        </div>
      )}
    </form>
  );
}

function SourceCard({
  source,
  timeZone,
  onTokenChanged,
}: {
  source: AdminTaskSource;
  timeZone: string;
  onTokenChanged: (notice: string) => void;
}) {
  const status = source.status;
  const badge =
    status.state === "enabled" || status.state === "starting"
      ? "On"
      : status.state === "halted"
        ? "Stopped"
        : "Off";
  const lines = [statusLine(source), tokenLine(source.token)].filter(
    (line): line is string => line !== null,
  );
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
      <TokenForm token={source.token} onChanged={onTokenChanged} />
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
  const [notice, setNotice] = useState<string | null>(null);
  const changed = (message: string) => {
    setNotice(message);
    void reload();
  };
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>Connected apps</div>
        <h1>Task sources</h1>
        <p className={styles.muted}>
          Tasks sent from other apps become assigned chores, due once.
        </p>
      </div>
      {notice && <output className={styles.success}>{notice}</output>}
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
            onSaved={() => changed("Default member saved.")}
          />
          {state.data.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              timeZone={state.data.timeZone}
              onTokenChanged={changed}
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
