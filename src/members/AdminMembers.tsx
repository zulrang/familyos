"use client";

import { type FormEvent, useState } from "react";
import styles from "@/shared/Admin.module.css";
import {
  adminRequest,
  adminRequestId,
  useAdminData,
} from "@/shared/admin-client";
import { readAdminMembers } from "./admin-client";
import { type HouseholdMember, LEGACY_TONE_COLORS } from "./members";

function MemberForm({
  member,
  version,
  onSaved,
  onCancel,
}: {
  member?: HouseholdMember;
  version: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id] = useState(() => member?.id ?? adminRequestId());
  const [name, setName] = useState(member?.name ?? "");
  const [color, setColor] = useState(
    member?.status === "active" ? member.color : LEGACY_TONE_COLORS.teal,
  );
  const [save, setSave] = useState<{
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSave({ status: "saving" });
    try {
      await adminRequest("members", {
        kind: member ? "edit" : "create",
        id,
        name,
        color,
        expectedVersion: version,
      });
      onSaved();
    } catch (error) {
      setSave({ status: "idle", error: (error as Error).message });
    }
  }
  return (
    <form className={`${styles.card} ${styles.form}`} onSubmit={submit}>
      <h2>{member ? "Edit member" : "Add a member"}</h2>
      <label>
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={100}
          autoComplete="off"
        />
      </label>
      {member?.status !== "retired" && (
        <label>
          Member color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      )}
      <p className={styles.muted}>
        {member?.status === "retired"
          ? "This member is retired. Their identity and history are preserved."
          : "Up to six active members, each with their own color."}
      </p>
      {save.error && (
        <p className={styles.error} role="alert">
          {save.error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" disabled={save.status === "saving"}>
          {save.status === "saving" ? "Saving…" : "Save member"}
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

export function AdminMembers() {
  const { state, reload } = useAdminData(readAdminMembers);
  const [editor, setEditor] = useState<
    { kind: "new" } | { kind: "edit"; member: HouseholdMember } | null
  >(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [retiring, setRetiring] = useState<string | null>(null);
  async function retire(member: HouseholdMember, version: number) {
    if (
      !window.confirm(
        `Retire ${member.name}? Their history and stars will stay. Fixed tasks will retire, and rotations will continue without them.`,
      )
    )
      return;
    setRetiring(member.id);
    setNotice(null);
    try {
      await adminRequest("members", {
        kind: "retire",
        id: member.id,
        expectedVersion: version,
      });
      await reload();
      setNotice({
        kind: "success",
        message: "Member retired. History preserved.",
      });
    } catch (error) {
      setNotice({ kind: "error", message: (error as Error).message });
    } finally {
      setRetiring(null);
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>Your household</div>
        <h1>Members</h1>
        <p className={styles.muted}>The people who make this place home.</p>
      </div>
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={styles[notice.kind]}
        >
          {notice.message}
        </p>
      )}
      {state.status === "loading" && <output>Loading members…</output>}
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
          {editor ? (
            <MemberForm
              key={editor.kind === "new" ? "new" : editor.member.id}
              member={editor.kind === "edit" ? editor.member : undefined}
              version={state.data.version}
              onCancel={() => setEditor(null)}
              onSaved={() => {
                setEditor(null);
                setNotice({ kind: "success", message: "Member saved." });
                void reload();
              }}
            />
          ) : (
            <button type="button" onClick={() => setEditor({ kind: "new" })}>
              Add member
            </button>
          )}
          {!state.data.members.length && (
            <p className={styles.card}>Add your first member to get started.</p>
          )}
          {state.data.members.map((member) => (
            <article className={styles.card} key={member.id}>
              <div className={styles.row}>
                <h2>
                  {member.status === "active" && (
                    <span
                      aria-hidden="true"
                      className={styles.dot}
                      style={{ background: member.color }}
                    />
                  )}
                  {member.name}
                </h2>
                <span className={styles.badge}>{member.status}</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.quiet}
                  disabled={!!editor || !!retiring}
                  onClick={() => setEditor({ kind: "edit", member })}
                  aria-label={`Edit ${member.name}`}
                >
                  Edit
                </button>
                {member.status === "active" && (
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={!!editor || !!retiring}
                    onClick={() => void retire(member, state.data.version)}
                    aria-label={`Retire ${member.name}`}
                  >
                    {retiring === member.id ? "Retiring…" : "Retire"}
                  </button>
                )}
              </div>
            </article>
          ))}
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              if (
                !editor ||
                window.confirm("Discard this unsaved member edit and refresh?")
              ) {
                setEditor(null);
                void reload();
              }
            }}
          >
            Refresh members
          </button>
        </>
      )}
    </div>
  );
}
