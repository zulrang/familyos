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
import { TaskRow } from "./TaskRow";
import {
  nowInstant,
  type Occurrence,
  type TasksViewRead,
  type TaskType,
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
    today: "1970-01-01" as TasksViewRead["today"],
    generatedAt: nowInstant(),
  };
}

type Draft = {
  title: string;
  type: TaskType;
  member: string;
  time: string;
};

const EMPTY_DRAFT: Draft = {
  title: "",
  type: "chore",
  member: "",
  time: "",
};

export function markDone(view: TasksViewRead, occ: Occurrence): TasksViewRead {
  const current = view.occurrences.find(
    (row) => row.task === occ.task && row.window === occ.window,
  );
  if (!current || current.state === "done" || current.assignee === null) {
    return view;
  }
  const by = current.assignee;
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
    progress: view.progress.map((row) =>
      row.member === by ? { ...row, done: row.done + 1 } : row,
    ),
  };
}

export function TasksScreen() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tasks, setTasks] = useState<TasksViewRead>(emptyView);
  const [sheet, setSheet] = useState<Draft | null>(null);
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

  async function complete(occ: Occurrence) {
    if (!occ.assignee) return;
    setTasks((cur) => markDone(cur, occ));
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
              by: occ.assignee,
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

  async function createTask() {
    if (!sheet) return;
    const title = sheet.title.trim();
    if (!title || !sheet.member) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type: sheet.type,
          member: sheet.member,
          ...(sheet.time ? { time: sheet.time } : {}),
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
            gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))`,
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
                    done={row.state === "done"}
                    surface={surface}
                    onComplete={() => complete(row)}
                  />
                ))}
              </MemberColumn>
            );
          })}
        </div>
      ) : null}
      {members.length > 0 ? (
        <Fab
          label="Add task"
          onClick={() =>
            setSheet({
              ...EMPTY_DRAFT,
              member: members[0]?.id ?? "",
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
  const canSave = draft.title.trim().length > 0 && draft.member.length > 0;
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {members.map((member) => {
            const surface = memberSurface(member.color);
            const selected = draft.member === member.id;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onChange({ ...draft, member: member.id })}
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
