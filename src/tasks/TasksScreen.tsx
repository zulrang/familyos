"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActiveMember,
  activeMembers,
  type MemberSurface,
  memberSurface,
  onFillInk,
} from "@/members/members";
import type { PublicSettings } from "@/settings/types";
import { AppHeader } from "@/shared/AppHeader";
import { redirectIfPairingRequired } from "@/shared/display-client";
import { formatClock } from "@/shared/time";
import { Button } from "@/shared/ui/Button";
import { Fab } from "@/shared/ui/Fab";
import { IconButton } from "@/shared/ui/IconButton";
import { MemberColumn } from "./MemberColumn";
import { TaskRow, type TaskRowStatus } from "./TaskRow";
import {
  nowInstant,
  type Occurrence,
  type TasksViewRead,
  type TaskType,
  type Weekday,
} from "./types";

function headerDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function LiveClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now ? formatClock(now, timeZone) : null;
}

function emptyView(): TasksViewRead {
  return {
    occurrences: [],
    progress: [],
    starBalances: [],
    today: "1970-01-01" as TasksViewRead["today"],
    generatedAt: nowInstant(),
  };
}

type DraftFields = {
  title: string;
  type: TaskType;
  recurrence: DraftRecurrence;
  time: string;
  stars: string;
};

type DraftRecurrence =
  | { kind: "daily" }
  | { kind: "once"; date: string }
  | { kind: "weekly"; days: Weekday[] }
  | { kind: "monthly"; day: string };

type RecurrenceRequest =
  | { kind: "daily" }
  | { kind: "once"; date: string }
  | { kind: "weekly"; days: Weekday[] }
  | { kind: "monthly"; day: number };

type DraftAssignment =
  | { kind: "fixed"; member: string }
  | { kind: "rotation"; order: string[] }
  | { kind: "open" };

type Draft = DraftFields & { assignment: DraftAssignment };

const RECURRENCE_CHOICES = [
  { label: "Once", value: { kind: "once", date: "" } },
  { label: "Daily", value: { kind: "daily" } },
  { label: "Weekly", value: { kind: "weekly", days: [] } },
  { label: "Monthly", value: { kind: "monthly", day: "1" } },
] satisfies { label: string; value: DraftRecurrence }[];

const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: "sun", label: "Sun" },
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
];

function parseDraftRecurrence(
  recurrence: DraftRecurrence,
): RecurrenceRequest | null {
  switch (recurrence.kind) {
    case "daily":
      return recurrence;
    case "once":
      return recurrence.date ? recurrence : null;
    case "weekly":
      return recurrence.days.length > 0 ? recurrence : null;
    case "monthly": {
      const day = Number(recurrence.day);
      return Number.isInteger(day) && day >= 1 && day <= 28
        ? { kind: "monthly", day }
        : null;
    }
    default: {
      const _exhaustive: never = recurrence;
      return _exhaustive;
    }
  }
}

type MemberAction =
  | { kind: "claim"; occurrence: Occurrence }
  | { kind: "complete"; occurrence: Occurrence };

const SKIP_PRESETS = ["Away", "Sick", "Not needed"] as const;

function rowStatus(row: Occurrence): TaskRowStatus {
  switch (row.state) {
    case "done":
      return { kind: "done" };
    case "skipped":
      return { kind: "skipped", reason: row.reason };
    case "pending":
    case "claimed":
    case "expired":
      return { kind: "open" };
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

function canSkip(row: Occurrence): boolean {
  return row.state === "pending" || row.state === "claimed";
}

const HOUSEHOLD_SURFACE: MemberSurface = {
  fill: "#dcebf6",
  soft: "#eef4f8",
  ink: "#425466",
};

export function markDone(
  view: TasksViewRead,
  occ: Occurrence,
  member?: string,
): TasksViewRead {
  const current = view.occurrences.find(
    (row) => row.task === occ.task && row.window === occ.window,
  );
  if (!current || current.state === "done") {
    return view;
  }
  const by = member ?? current.assignee;
  if (!by) return view;
  const priorAssignee = current.assignee;
  return {
    ...view,
    occurrences: view.occurrences.map((row) =>
      row.task === occ.task && row.window === occ.window
        ? {
            ...row,
            state: "done" as const,
            by,
            at: nowInstant(),
            assignee: by,
          }
        : row,
    ),
    progress: view.progress.map((row) => {
      if (row.member === by) {
        return {
          ...row,
          done: row.done + 1,
          total: row.total + (priorAssignee === by ? 0 : 1),
        };
      }
      if (priorAssignee !== null && row.member === priorAssignee) {
        return { ...row, total: row.total - 1 };
      }
      return row;
    }),
  };
}

export function claimOccurrence(
  view: TasksViewRead,
  occ: Occurrence,
  member: string,
): TasksViewRead {
  const current = view.occurrences.find(
    (row) => row.task === occ.task && row.window === occ.window,
  );
  if (!current || current.state !== "pending" || current.assignee !== null) {
    return view;
  }
  return {
    ...view,
    occurrences: view.occurrences.map((row) =>
      row.task === occ.task && row.window === occ.window
        ? {
            ...row,
            state: "claimed" as const,
            by: member,
            assignee: member,
          }
        : row,
    ),
    progress: view.progress.map((row) =>
      row.member === member ? { ...row, total: row.total + 1 } : row,
    ),
  };
}

export function skipOccurrence(
  view: TasksViewRead,
  occ: Occurrence,
  reason: string | null,
): TasksViewRead {
  const current = view.occurrences.find(
    (row) => row.task === occ.task && row.window === occ.window,
  );
  if (!current || current.state === "done" || current.state === "skipped") {
    return view;
  }
  return {
    ...view,
    occurrences: view.occurrences.map((row) =>
      row.task === occ.task && row.window === occ.window
        ? { ...row, state: "skipped" as const, reason }
        : row,
    ),
  };
}

export function TasksScreen() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tasks, setTasks] = useState<TasksViewRead>(emptyView);
  const [sheet, setSheet] = useState<Draft | null>(null);
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null);
  const [skipping, setSkipping] = useState<Occurrence | null>(null);
  const [skipNote, setSkipNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sRes = await fetch("/api/settings");
    if (await redirectIfPairingRequired(sRes)) return;
    if (!sRes.ok) {
      setError("Could not load tasks.");
      return;
    }
    const s = (await sRes.json()) as PublicSettings;
    setSettings(s);
    const res = await fetch("/api/tasks");
    if (await redirectIfPairingRequired(res)) return;
    if (!res.ok) {
      setError("Could not load tasks.");
      return;
    }
    setTasks((await res.json()) as TasksViewRead);
    setError(null);
  }, []);

  useEffect(() => {
    load().catch(() => setError("Could not load tasks."));
    const poll = setInterval(() => {
      load().catch(() => {});
    }, 60_000);
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const members = settings ? activeMembers(settings.members) : [];

  async function complete(occ: Occurrence, member = occ.assignee) {
    if (!member) {
      setMemberAction({ kind: "complete", occurrence: occ });
      return;
    }
    setTasks((cur) => markDone(cur, occ, member));
    try {
      const res = await fetch("/api/tasks/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: occ.task,
              window: occ.window,
              by: member,
              at: new Date().toISOString(),
            },
          ],
        }),
      });
      if (await redirectIfPairingRequired(res)) return;
      if (!res.ok) {
        setError("Could not complete task.");
      }
      await load();
    } catch {
      setError("Could not complete task.");
      await load();
    }
  }

  async function claim(occ: Occurrence, member?: string) {
    if (!member) {
      setMemberAction({ kind: "claim", occurrence: occ });
      return;
    }
    setTasks((cur) => claimOccurrence(cur, occ, member));
    try {
      const res = await fetch("/api/tasks/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              kind: "claimed",
              task: occ.task,
              window: occ.window,
              by: member,
            },
          ],
        }),
      });
      if (await redirectIfPairingRequired(res)) return;
      if (!res.ok) {
        setError("Could not claim task.");
      }
      await load();
    } catch {
      setError("Could not claim task.");
      await load();
    }
  }

  async function skip(occ: Occurrence, reason: string | null) {
    setSkipping(null);
    setSkipNote("");
    setTasks((cur) => skipOccurrence(cur, occ, reason));
    try {
      const res = await fetch("/api/tasks/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [
            {
              kind: "skipped",
              task: occ.task,
              window: occ.window,
              reason,
            },
          ],
        }),
      });
      if (await redirectIfPairingRequired(res)) return;
      if (!res.ok) {
        setError("Could not skip task.");
      }
      await load();
    } catch {
      setError("Could not skip task.");
      await load();
    }
  }

  async function createTask() {
    if (!sheet) return;
    const title = sheet.title.trim();
    const recurrence = parseDraftRecurrence(sheet.recurrence);
    const stars = Number(sheet.stars);
    if (
      !title ||
      (sheet.assignment.kind === "fixed" && !sheet.assignment.member) ||
      (sheet.assignment.kind === "rotation" &&
        sheet.assignment.order.length === 0) ||
      !recurrence ||
      !Number.isSafeInteger(stars) ||
      stars < 0
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type: sheet.type,
          recurrence,
          assignment: sheet.assignment,
          ...(sheet.time ? { time: sheet.time } : {}),
          stars,
        }),
      });
      if (await redirectIfPairingRequired(res)) return;
      if (!res.ok) {
        setError("Could not create task.");
        return;
      }
      setSheet(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const surfaces = new Map<string, MemberSurface>(
    members.map((member) => [member.id, memberSurface(member.color)]),
  );
  const householdRows = tasks.occurrences.filter(
    (row) =>
      row.assignee === null &&
      (row.state === "pending" || row.state === "skipped"),
  );
  const columnCount = members.length + (householdRows.length > 0 ? 1 : 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "var(--surface-screen)",
        position: "relative",
      }}
    >
      <AppHeader
        title={settings ? headerDate(now, settings.timeZone) : ""}
        time={settings ? <LiveClock timeZone={settings.timeZone} /> : null}
      />
      {error ? (
        <div
          style={{
            padding: "0 24px 12px",
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
          }}
        >
          {error}
        </div>
      ) : null}
      {members.length === 0 && settings ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "var(--type-section)",
            color: "var(--text-faint)",
          }}
        >
          Add household members under Settings
        </div>
      ) : null}
      {members.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            gap: 14,
            padding: "4px 24px 24px",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {members.map((member) => {
            const surface =
              surfaces.get(member.id) ?? memberSurface(member.color);
            const progress = tasks.progress.find(
              (row) => row.member === member.id,
            ) ?? {
              member: member.id,
              done: 0,
              total: 0,
            };
            const rows = tasks.occurrences.filter(
              (row) => row.assignee === member.id,
            );
            return (
              <MemberColumn
                key={member.id}
                name={member.name}
                surface={surface}
                done={progress.done}
                total={progress.total}
              >
                {rows.map((row) => (
                  <TaskRow
                    key={`${row.task}:${row.window}`}
                    label={row.title}
                    time={row.time}
                    status={rowStatus(row)}
                    surface={surface}
                    onComplete={() => complete(row)}
                    onSkip={
                      canSkip(row)
                        ? () => {
                            setSkipNote("");
                            setSkipping(row);
                          }
                        : undefined
                    }
                  />
                ))}
              </MemberColumn>
            );
          })}
          {householdRows.length > 0 ? (
            <MemberColumn
              name="Household"
              surface={HOUSEHOLD_SURFACE}
              done={0}
              total={householdRows.length}
            >
              {householdRows.map((row) => (
                <TaskRow
                  key={`${row.task}:${row.window}`}
                  label={row.title}
                  time={row.time}
                  status={rowStatus(row)}
                  surface={HOUSEHOLD_SURFACE}
                  onClaim={
                    row.state === "pending" ? () => claim(row) : undefined
                  }
                  onSkip={
                    canSkip(row)
                      ? () => {
                          setSkipNote("");
                          setSkipping(row);
                        }
                      : undefined
                  }
                  onComplete={() => complete(row)}
                />
              ))}
            </MemberColumn>
          ) : null}
        </div>
      ) : null}
      {members.length > 0 ? (
        <Fab
          label="Add task"
          onClick={() =>
            setSheet({
              title: "",
              type: "chore",
              recurrence: { kind: "daily" },
              assignment: {
                kind: "fixed",
                member: members[0]?.id ?? "",
              },
              time: "",
              stars: "0",
            })
          }
        />
      ) : null}
      {sheet ? (
        <CreateSheet
          draft={sheet}
          members={members}
          busy={busy}
          onChange={setSheet}
          onClose={() => setSheet(null)}
          onSave={createTask}
        />
      ) : null}
      {memberAction ? (
        <MemberPicker
          action={memberAction.kind}
          members={members}
          onClose={() => setMemberAction(null)}
          onPick={(member) => {
            const action = memberAction;
            setMemberAction(null);
            if (action.kind === "claim") {
              claim(action.occurrence, member.id).catch(() => {});
            } else {
              complete(action.occurrence, member.id).catch(() => {});
            }
          }}
        />
      ) : null}
      {skipping ? (
        <SkipSheet
          title={skipping.title}
          note={skipNote}
          onNote={setSkipNote}
          onClose={() => {
            setSkipping(null);
            setSkipNote("");
          }}
          onSkip={(reason) => {
            skip(skipping, reason).catch(() => {});
          }}
        />
      ) : null}
    </div>
  );
}

function CreateSheet({
  draft,
  members,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft;
  members: ActiveMember[];
  busy: boolean;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const closeFromBackdrop = useRef(false);
  const stars = Number(draft.stars);
  const assignmentReady =
    draft.assignment.kind === "open" ||
    (draft.assignment.kind === "fixed" && draft.assignment.member.length > 0) ||
    (draft.assignment.kind === "rotation" && draft.assignment.order.length > 0);
  const canSave =
    draft.title.trim().length > 0 &&
    assignmentReady &&
    parseDraftRecurrence(draft.recurrence) !== null &&
    Number.isSafeInteger(stars) &&
    stars >= 0;
  const weeklyDays =
    draft.recurrence.kind === "weekly" ? draft.recurrence.days : null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onPointerDown={() => {
          closeFromBackdrop.current = true;
        }}
        onClick={() => {
          if (!closeFromBackdrop.current) return;
          closeFromBackdrop.current = false;
          onClose();
        }}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <div
        style={{
          position: "relative",
          width: 420,
          maxWidth: "calc(100% - 48px)",
          background: "var(--surface-screen)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ font: "var(--type-section)", flex: 1 }}>New task</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <input
          className="fos-input"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
        <div style={{ display: "flex", gap: 10 }}>
          {(["chore", "routine"] as const).map((type) => (
            <Button
              key={type}
              variant={draft.type === type ? "primary" : "secondary"}
              onClick={() => onChange({ ...draft, type })}
              style={{ flex: 1, textTransform: "capitalize" }}
            >
              {type === "chore" ? "Chore" : "Routine"}
            </Button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            variant={
              draft.assignment.kind === "fixed" ? "primary" : "secondary"
            }
            onClick={() =>
              onChange({
                ...draft,
                assignment: {
                  kind: "fixed",
                  member:
                    draft.assignment.kind === "fixed"
                      ? draft.assignment.member
                      : draft.assignment.kind === "rotation"
                        ? (draft.assignment.order[0] ?? members[0]?.id ?? "")
                        : (members[0]?.id ?? ""),
                },
              })
            }
            style={{ flex: 1 }}
          >
            Fixed
          </Button>
          <Button
            variant={
              draft.assignment.kind === "rotation" ? "primary" : "secondary"
            }
            onClick={() =>
              onChange({
                ...draft,
                assignment: {
                  kind: "rotation",
                  order:
                    draft.assignment.kind === "rotation"
                      ? draft.assignment.order
                      : draft.assignment.kind === "fixed"
                        ? [draft.assignment.member]
                        : members[0]
                          ? [members[0].id]
                          : [],
                },
              })
            }
            style={{ flex: 1 }}
          >
            Rotation
          </Button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {RECURRENCE_CHOICES.map(({ label, value }) => (
            <Button
              key={value.kind}
              variant={
                draft.recurrence.kind === value.kind ? "primary" : "secondary"
              }
              onClick={() => onChange({ ...draft, recurrence: value })}
              style={{ flex: 1 }}
            >
              {label}
            </Button>
          ))}
        </div>
        {draft.recurrence.kind === "once" ? (
          <input
            className="fos-input"
            type="date"
            aria-label="Date"
            value={draft.recurrence.date}
            onChange={(event) =>
              onChange({
                ...draft,
                recurrence: { kind: "once", date: event.target.value },
              })
            }
          />
        ) : null}
        {weeklyDays ? (
          <div style={{ display: "flex", gap: 6 }}>
            {WEEKDAY_OPTIONS.map(({ value, label }) => {
              const selected = weeklyDays.includes(value);
              return (
                <Button
                  key={value}
                  variant={selected ? "primary" : "secondary"}
                  onClick={() => {
                    const days = selected
                      ? weeklyDays.filter((day) => day !== value)
                      : [...weeklyDays, value];
                    onChange({
                      ...draft,
                      recurrence: { kind: "weekly", days },
                    });
                  }}
                  aria-pressed={selected}
                  style={{ flex: 1, paddingInline: 8 }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        ) : null}
        {draft.recurrence.kind === "monthly" ? (
          <input
            className="fos-input"
            type="number"
            min={1}
            max={28}
            step={1}
            aria-label="Day of month"
            value={draft.recurrence.day}
            onChange={(event) =>
              onChange({
                ...draft,
                recurrence: { kind: "monthly", day: event.target.value },
              })
            }
          />
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={() => onChange({ ...draft, assignment: { kind: "open" } })}
            style={{
              border: "none",
              borderRadius: "var(--radius-pill)",
              padding: "8px 14px",
              minHeight: "var(--hit-min)",
              background:
                draft.assignment.kind === "open"
                  ? HOUSEHOLD_SURFACE.fill
                  : HOUSEHOLD_SURFACE.soft,
              color: HOUSEHOLD_SURFACE.ink,
              font: "var(--type-card-meta)",
              cursor: "pointer",
            }}
          >
            Household
          </button>
          {members.map((member) => {
            const surface = memberSurface(member.color);
            const position =
              draft.assignment.kind === "fixed"
                ? draft.assignment.member === member.id
                  ? 0
                  : -1
                : draft.assignment.kind === "rotation"
                  ? draft.assignment.order.indexOf(member.id)
                  : -1;
            const selected = position >= 0;
            return (
              <button
                key={member.id}
                type="button"
                aria-label={member.name}
                aria-pressed={selected}
                onClick={() => {
                  if (draft.assignment.kind !== "rotation") {
                    onChange({
                      ...draft,
                      assignment: { kind: "fixed", member: member.id },
                    });
                    return;
                  }
                  onChange({
                    ...draft,
                    assignment: {
                      kind: "rotation",
                      order: selected
                        ? draft.assignment.order.filter(
                            (id) => id !== member.id,
                          )
                        : [...draft.assignment.order, member.id],
                    },
                  });
                }}
                style={{
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  padding: "8px 14px",
                  minHeight: "var(--hit-min)",
                  background: selected ? surface.fill : surface.soft,
                  color: selected ? onFillInk(surface.fill) : surface.ink,
                  font: "var(--type-card-meta)",
                  cursor: "pointer",
                }}
              >
                {member.name}
                {draft.assignment.kind === "rotation" && selected ? (
                  <span
                    aria-hidden="true"
                    style={{
                      marginLeft: 7,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {position + 1}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <input
          className="fos-input"
          type="time"
          aria-label="Time"
          value={draft.time}
          onChange={(e) => onChange({ ...draft, time: e.target.value })}
        />
        <input
          className="fos-input"
          type="number"
          min="0"
          max={Number.MAX_SAFE_INTEGER}
          step="1"
          aria-label="Stars"
          value={draft.stars}
          onChange={(e) => onChange({ ...draft, stars: e.target.value })}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="primary"
            disabled={busy || !canSave}
            onClick={onSave}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function MemberPicker({
  action,
  members,
  onClose,
  onPick,
}: {
  action: MemberAction["kind"];
  members: ActiveMember[];
  onClose: () => void;
  onPick: (member: ActiveMember) => void;
}) {
  const title = action === "claim" ? "Claim task" : "Complete task";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-member-picker-title"
        style={{
          position: "relative",
          width: 360,
          maxWidth: "calc(100% - 48px)",
          background: "var(--surface-screen)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2
            id="task-member-picker-title"
            style={{ font: "var(--type-section)", flex: 1 }}
          >
            {title}
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {members.map((member) => {
            const surface = memberSurface(member.color);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onPick(member)}
                style={{
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  padding: "8px 14px",
                  minHeight: "var(--hit-min)",
                  background: surface.soft,
                  color: surface.ink,
                  font: "var(--type-card-meta)",
                  cursor: "pointer",
                }}
              >
                {member.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SkipSheet({
  title,
  note,
  onNote,
  onClose,
  onSkip,
}: {
  title: string;
  note: string;
  onNote: (note: string) => void;
  onClose: () => void;
  onSkip: (reason: string | null) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-skip-title"
        style={{
          position: "relative",
          width: 360,
          maxWidth: "calc(100% - 48px)",
          background: "var(--surface-screen)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2
            id="task-skip-title"
            style={{ font: "var(--type-section)", flex: 1 }}
          >
            Skip task
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div
          style={{ font: "var(--type-card-meta)", color: "var(--text-muted)" }}
        >
          {title}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SKIP_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onSkip(preset)}
              style={{
                border: "none",
                borderRadius: "var(--radius-pill)",
                padding: "8px 14px",
                minHeight: "var(--hit-min)",
                background: HOUSEHOLD_SURFACE.soft,
                color: HOUSEHOLD_SURFACE.ink,
                font: "var(--type-card-meta)",
                cursor: "pointer",
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          className="fos-input"
          placeholder="Reason (optional)"
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={() => onSkip(note.trim() || null)}>
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
