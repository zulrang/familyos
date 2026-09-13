"use client";

import { type FormEvent, useRef, useState } from "react";
import styles from "@/shared/Admin.module.css";
import { AdminEditorScreen } from "@/shared/AdminEditorScreen";
import {
  adminRequest,
  adminRequestId,
  useAdminData,
} from "@/shared/admin-client";
import { readTaskAdminData } from "./admin-client";
import type { BountyAdminCommand } from "./admin-types";
import {
  bountyManagementStatus,
  bountyScheduleLabel,
} from "./bounty-management";
import {
  type BountyDefinition,
  parseBountyCommandId,
  parseStarAmount,
  parseTaskTitle,
} from "./types";

function bountyRequestId() {
  const requestId = parseBountyCommandId(adminRequestId());
  if (!requestId)
    throw new Error("Could not create a Bounty request identity.");
  return requestId;
}

type RetireBountyCommand = Extract<
  BountyAdminCommand,
  { kind: "retire-bounty" }
>;

function BountyForm({
  bounty,
  onSaved,
  onCancel,
}: {
  bounty: BountyDefinition;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState<string>(bounty.title);
  const [stars, setStars] = useState(String(bounty.stars));
  const [save, setSave] = useState<
    | { status: "editing"; error?: string }
    | { status: "saving" }
    | { status: "retry"; error: string }
  >({ status: "editing" });
  const command = useRef<BountyAdminCommand | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.status === "saving") return;
    const parsedTitle = parseTaskTitle(title);
    const parsedStars = parseStarAmount(Number(stars));
    if (!parsedTitle || parsedStars === null) {
      setSave({
        status: "editing",
        error: "Enter a title and a nonnegative whole-number Star reward.",
      });
      return;
    }
    command.current ??= {
      kind: "edit-bounty",
      requestId: bountyRequestId(),
      definition: bounty.id,
      revision: bounty.revision,
      draft: { title: parsedTitle, stars: parsedStars },
    };
    setSave({ status: "saving" });
    try {
      await adminRequest("tasks", command.current);
      onSaved();
    } catch (error) {
      setSave({
        status: "retry",
        error:
          error instanceof Error ? error.message : "Could not save Bounty.",
      });
    }
  }

  return (
    <AdminEditorScreen
      title={`Edit ${bounty.title}`}
      backLabel="Bounties"
      onBack={onCancel}
      busy={save.status === "saving"}
    >
      {(close) => (
        <form className={styles.form} onSubmit={submit}>
          <fieldset
            className={styles.fields}
            disabled={save.status !== "editing"}
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
            <label>
              Stars per completion
              <input
                required
                type="number"
                inputMode="numeric"
                min={0}
                max={Number.MAX_SAFE_INTEGER}
                step={1}
                value={stars}
                onChange={(event) => setStars(event.target.value)}
              />
            </label>
          </fieldset>
          {"error" in save && save.error && (
            <p role="alert" className={styles.error}>
              {save.error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" disabled={save.status === "saving"}>
              {save.status === "saving"
                ? "Saving…"
                : save.status === "retry"
                  ? "Retry save"
                  : "Save Bounty"}
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

export function AdminBounties() {
  const { state, reload } = useAdminData(readTaskAdminData);
  const [editor, setEditor] = useState<BountyDefinition | null>(null);
  const [query, setQuery] = useState("");
  const retirementCommand = useRef<RetireBountyCommand | null>(null);
  const retirementSaving = useRef(false);
  const [retirement, setRetirement] = useState<
    | { status: "saving"; command: RetireBountyCommand }
    | { status: "retry"; command: RetireBountyCommand }
    | null
  >(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  async function retire(bounty: BountyDefinition) {
    if (retirementSaving.current) return;
    const retry =
      retirementCommand.current?.definition === bounty.id
        ? retirementCommand.current
        : null;
    if (
      !retry &&
      !window.confirm(
        `Retire “${bounty.title}”? New claims will stop. Existing claims can still be completed or released.`,
      )
    ) {
      return;
    }
    const command: RetireBountyCommand = retry ?? {
      kind: "retire-bounty",
      requestId: bountyRequestId(),
      definition: bounty.id,
      revision: bounty.revision,
    };
    retirementCommand.current = command;
    retirementSaving.current = true;
    setRetirement({ status: "saving", command });
    setNotice(null);
    try {
      await adminRequest("tasks", command);
      setNotice({
        kind: "success",
        message: "Bounty retired. History preserved.",
      });
      await reload();
      retirementCommand.current = null;
      setRetirement(null);
    } catch (error) {
      setRetirement({ status: "retry", command });
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not retire Bounty.",
      });
    } finally {
      retirementSaving.current = false;
    }
  }

  const visible =
    state.status === "ready"
      ? state.data.tasks.bountyDefinitions.filter((bounty) =>
          bounty.title.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : [];

  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>Work anyone can choose</div>
        <h1>Bounties</h1>
        <p className={styles.muted}>
          Update available work and keep accepted commitments intact.
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
      <div className={styles.form}>
        <label>
          Search
          <input
            type="search"
            placeholder="Find a Bounty…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {state.status === "loading" && <output>Loading Bounties…</output>}
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
          {visible.length === 0 && (
            <p className={styles.card}>No matching Bounties.</p>
          )}
          {visible.map((bounty) => {
            const claims = state.data.tasks.bountyClaims.filter(
              (row) => row.claim.offering.definition === bounty.id,
            );
            const status = bountyManagementStatus({
              definition: bounty,
              claims,
              today: state.data.tasks.today,
            });
            return (
              <article className={styles.card} key={bounty.id}>
                <div className={styles.row}>
                  <h2>{bounty.title}</h2>
                  <span className={styles.badge}>{status}</span>
                </div>
                <p className={styles.muted}>
                  {bountyScheduleLabel(bounty)}
                  <br />
                  {bounty.stars} {bounty.stars === 1 ? "Star" : "Stars"} per
                  completion
                  <br />
                  {claims.length} historical{" "}
                  {claims.length === 1 ? "claim" : "claims"}
                </p>
                {claims.length > 0 && (
                  <details>
                    <summary>Claim history</summary>
                    <ul>
                      {claims.map((row) => {
                        const member = state.data.members.find(
                          (person) => person.id === row.claim.member,
                        );
                        return (
                          <li key={row.claim.id}>
                            {row.claim.title} · {row.claim.stars}{" "}
                            {row.claim.stars === 1 ? "Star" : "Stars"} ·{" "}
                            {member?.name ?? row.claim.member} ·{" "}
                            {row.claim.scheduledOn} · {row.state.kind}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
                {bounty.retiredAt ? (
                  <p className={styles.muted}>
                    Retired {bounty.retiredAt}. Accepted claims keep their title
                    and reward.
                  </p>
                ) : (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={retirement?.status === "saving"}
                      aria-label={`Edit ${bounty.title}`}
                      onClick={() => setEditor(bounty)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={retirement?.status === "saving"}
                      aria-label={`${
                        retirement?.status === "retry" &&
                        retirement.command.definition === bounty.id
                          ? "Retry retire"
                          : "Retire"
                      } ${bounty.title}`}
                      onClick={() => void retire(bounty)}
                    >
                      {retirement?.command.definition === bounty.id
                        ? retirement.status === "saving"
                          ? "Retiring…"
                          : "Retry retire"
                        : "Retire"}
                    </button>
                    {retirement?.status === "retry" &&
                    retirement.command.definition === bounty.id ? (
                      <button
                        type="button"
                        className={styles.quiet}
                        onClick={() => {
                          retirementCommand.current = null;
                          setRetirement(null);
                          setNotice(null);
                        }}
                      >
                        Cancel retry
                      </button>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
          <button
            type="button"
            className={styles.quiet}
            disabled={retirement?.status === "saving"}
            onClick={() => {
              if (retirementSaving.current) return;
              retirementCommand.current = null;
              setRetirement(null);
              setNotice(null);
              void reload();
            }}
          >
            Refresh Bounties
          </button>
        </>
      )}
      {editor && state.status === "ready" && (
        <BountyForm
          key={`${editor.id}:${editor.revision}`}
          bounty={editor}
          onSaved={() => {
            setEditor(null);
            setNotice({ kind: "success", message: "Bounty saved." });
            void reload();
          }}
          onCancel={() => setEditor(null)}
        />
      )}
    </div>
  );
}
