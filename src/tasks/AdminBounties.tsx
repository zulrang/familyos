"use client";

import { type FormEvent, useRef, useState } from "react";
import { activeMembers, type HouseholdMember } from "@/members/members";
import styles from "@/shared/Admin.module.css";
import { AdminEditorScreen } from "@/shared/AdminEditorScreen";
import {
  adminRequest,
  adminRequestId,
  useAdminData,
} from "@/shared/admin-client";
import { readTaskAdminData } from "./admin-client";
import type {
  BountyAdminCommand,
  DefinitionReplacementCommand,
} from "./admin-types";
import {
  type BountyRecurrenceDraft,
  BountyRecurrenceEditor,
  parseBountyRecurrenceDraft,
} from "./BountyRecurrenceEditor";
import { sameBountyRecurrence } from "./bounty-calendar";
import {
  bountyManagementStatus,
  bountyScheduleLabel,
} from "./bounty-management";
import {
  type BountyDefinition,
  type LocalDate,
  parseBountyCommandId,
  parseCreateTaskDraft,
  parseStarAmount,
  parseTaskTitle,
  type Weekday,
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

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type AssignedScheduleDraft =
  | { kind: "once"; date: string }
  | { kind: "daily" }
  | { kind: "weekly"; days: Weekday[] }
  | { kind: "monthly"; day: string };

type AssignedAssignmentDraft =
  | { kind: "fixed"; member: string }
  | { kind: "rotation"; order: string[] };

function recurrenceDraft(bounty: BountyDefinition): BountyRecurrenceDraft {
  if (bounty.recurrence.kind === "once") return { kind: "once" };
  const cadence = bounty.recurrence.cadence;
  return {
    kind: "recurring",
    startsOn: bounty.recurrence.startsOn,
    cadence:
      cadence.kind === "monthly"
        ? { kind: "monthly", day: String(cadence.day) }
        : cadence,
  };
}

function assignedScheduleDraft(
  bounty: BountyDefinition,
  today: LocalDate,
): AssignedScheduleDraft {
  if (bounty.recurrence.kind === "once") return { kind: "once", date: today };
  const cadence = bounty.recurrence.cadence;
  if (cadence.kind === "weekly") {
    return { kind: "weekly", days: [...cadence.days] };
  }
  if (cadence.kind === "monthly") {
    return { kind: "monthly", day: String(cadence.day) };
  }
  return { kind: "daily" };
}

function BountyForm({
  bounty,
  members,
  today,
  onSaved,
  onCancel,
}: {
  bounty: BountyDefinition;
  members: HouseholdMember[];
  today: LocalDate;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const roster = activeMembers(members);
  const [title, setTitle] = useState<string>(bounty.title);
  const [stars, setStars] = useState(String(bounty.stars));
  const [target, setTarget] = useState<"bounty" | "assigned">("bounty");
  const [bountyRecurrence, setBountyRecurrence] =
    useState<BountyRecurrenceDraft>(() => recurrenceDraft(bounty));
  const [assignedSchedule, setAssignedSchedule] =
    useState<AssignedScheduleDraft>(() => assignedScheduleDraft(bounty, today));
  const [assignedAssignment, setAssignedAssignment] =
    useState<AssignedAssignmentDraft>({
      kind: "fixed",
      member: roster[0]?.id ?? "",
    });
  const [time, setTime] = useState("");
  const [save, setSave] = useState<
    | { status: "editing"; error?: string }
    | { status: "saving" }
    | { status: "retry"; error: string }
  >({ status: "editing" });
  const command = useRef<
    BountyAdminCommand | DefinitionReplacementCommand | null
  >(null);
  const saving = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const parsedTitle = parseTaskTitle(title);
    const parsedStars = parseStarAmount(Number(stars));
    const replacement =
      target === "bounty"
        ? (() => {
            const recurrence = parseBountyRecurrenceDraft(bountyRecurrence);
            return parsedTitle && parsedStars !== null && recurrence
              ? {
                  kind: "bounty" as const,
                  type: "chore" as const,
                  title: parsedTitle,
                  stars: parsedStars,
                  recurrence,
                }
              : null;
          })()
        : (() => {
            const draft = parseCreateTaskDraft({
              title,
              type: "chore",
              recurrence:
                assignedSchedule.kind === "monthly"
                  ? { kind: "monthly", day: Number(assignedSchedule.day) }
                  : assignedSchedule,
              assignment: assignedAssignment,
              time,
              stars: Number(stars),
            });
            return draft &&
              draft.type === "chore" &&
              draft.assignment.kind !== "open"
              ? {
                  kind: "assigned" as const,
                  title: draft.title,
                  type: "chore" as const,
                  recurrence: draft.recurrence,
                  assignment: draft.assignment,
                  time: draft.time,
                  stars: draft.stars,
                }
              : null;
          })();
    if (!replacement) {
      setSave({
        status: "editing",
        error:
          target === "bounty"
            ? "Enter a title, valid schedule, and nonnegative whole-number Star reward."
            : "Check the schedule, assignment, time, and Star reward. Assigned Chores need one member or a nonempty rotation.",
      });
      return;
    }
    command.current ??=
      replacement.kind === "bounty" &&
      sameBountyRecurrence(bounty.recurrence, replacement.recurrence)
        ? {
            kind: "edit-bounty",
            requestId: bountyRequestId(),
            definition: bounty.id,
            revision: bounty.revision,
            draft: { title: replacement.title, stars: replacement.stars },
          }
        : {
            kind: "replace-definition",
            requestId: bountyRequestId(),
            source: {
              kind: "bounty",
              definition: bounty.id,
              revision: bounty.revision,
            },
            replacement,
          };
    saving.current = true;
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
    } finally {
      saving.current = false;
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
              Work mode
              <select
                value={target}
                onChange={(event) =>
                  setTarget(
                    event.target.value === "assigned" ? "assigned" : "bounty",
                  )
                }
              >
                <option value="bounty">Bounty</option>
                <option value="assigned">Assigned Chore</option>
              </select>
            </label>
            <label>
              Title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {target === "bounty" ? (
              <BountyRecurrenceEditor
                draft={bountyRecurrence}
                defaultStartsOn={today}
                onChange={setBountyRecurrence}
              />
            ) : (
              <>
                <label>
                  Repeat
                  <select
                    value={assignedSchedule.kind}
                    onChange={(event) => {
                      const kind = event.target.value;
                      setAssignedSchedule(
                        kind === "once"
                          ? { kind, date: today }
                          : kind === "weekly"
                            ? { kind, days: ["mon"] }
                            : kind === "monthly"
                              ? { kind, day: "1" }
                              : { kind: "daily" },
                      );
                    }}
                  >
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {assignedSchedule.kind === "once" ? (
                  <label>
                    Date
                    <input
                      type="date"
                      required
                      value={assignedSchedule.date}
                      onChange={(event) =>
                        setAssignedSchedule({
                          kind: "once",
                          date: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : null}
                {assignedSchedule.kind === "weekly" ? (
                  <fieldset>
                    <legend>Days</legend>
                    <div className={styles.grid}>
                      {WEEKDAYS.map((weekday) => (
                        <label className={styles.check} key={weekday}>
                          <input
                            type="checkbox"
                            checked={assignedSchedule.days.includes(weekday)}
                            onChange={(event) =>
                              setAssignedSchedule({
                                kind: "weekly",
                                days: event.target.checked
                                  ? WEEKDAYS.filter(
                                      (value) =>
                                        value === weekday ||
                                        assignedSchedule.days.includes(value),
                                    )
                                  : assignedSchedule.days.filter(
                                      (value) => value !== weekday,
                                    ),
                              })
                            }
                          />
                          {weekday[0].toUpperCase() + weekday.slice(1)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                {assignedSchedule.kind === "monthly" ? (
                  <label>
                    Day of month (1–28)
                    <input
                      type="number"
                      min={1}
                      max={28}
                      step={1}
                      required
                      value={assignedSchedule.day}
                      onChange={(event) =>
                        setAssignedSchedule({
                          kind: "monthly",
                          day: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : null}
                <label>
                  Assignment
                  <select
                    value={assignedAssignment.kind}
                    onChange={(event) =>
                      setAssignedAssignment(
                        event.target.value === "rotation"
                          ? { kind: "rotation", order: [] }
                          : { kind: "fixed", member: roster[0]?.id ?? "" },
                      )
                    }
                  >
                    <option value="fixed">One member</option>
                    <option value="rotation">Take turns</option>
                  </select>
                </label>
                {assignedAssignment.kind === "fixed" ? (
                  <label>
                    Member
                    <select
                      required
                      value={assignedAssignment.member}
                      onChange={(event) =>
                        setAssignedAssignment({
                          kind: "fixed",
                          member: event.target.value,
                        })
                      }
                    >
                      <option value="">Choose a member</option>
                      {roster.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <fieldset>
                    <legend>Rotation members</legend>
                    {roster.map((person) => (
                      <label className={styles.check} key={person.id}>
                        <input
                          type="checkbox"
                          checked={assignedAssignment.order.includes(person.id)}
                          onChange={(event) =>
                            setAssignedAssignment({
                              kind: "rotation",
                              order: event.target.checked
                                ? [...assignedAssignment.order, person.id]
                                : assignedAssignment.order.filter(
                                    (id) => id !== person.id,
                                  ),
                            })
                          }
                        />
                        {person.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label>
                  Time (optional)
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                </label>
              </>
            )}
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
          <p className={styles.muted}>
            Schedule changes affect future offerings. Existing claims keep their
            title, date, and Stars.
          </p>
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
            const carriers =
              state.data.tasks.legacyBountyCompletionCarriers.filter(
                (row) => row.definition === bounty.id,
              );
            const status = bountyManagementStatus({
              definition: bounty,
              claims,
              carriers,
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
          members={state.data.members}
          today={state.data.tasks.today}
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
