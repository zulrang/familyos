"use client";

import { type ComponentType, useEffect, useState } from "react";
import { AppHeader } from "@/shared/AppHeader";
import { formatClock } from "@/shared/time";
import { Fab } from "@/shared/ui/Fab";
import { type MemberDayProps, TasksBoard } from "./TasksBoard";
import { useTasksWorkspace } from "./TasksWorkspace";

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

export function TasksScreen({
  MemberDay,
}: {
  MemberDay?: ComponentType<MemberDayProps>;
}) {
  const { now, settings, members, tasks, error, actions, newTask, dialogs } =
    useTasksWorkspace();
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
          role="alert"
          style={{
            padding: "0 24px 12px",
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
          }}
        >
          {error}
        </div>
      ) : null}
      {settings ? (
        <TasksBoard
          members={members}
          tasks={tasks}
          memberDay={
            MemberDay
              ? {
                  Component: MemberDay,
                  day: now,
                  timeZone: settings.timeZone,
                  calendarId: settings.calendarId,
                }
              : undefined
          }
          {...actions}
        />
      ) : null}
      {members.length > 0 ? (
        <Fab label="Add task" onClick={() => newTask()} />
      ) : null}
      {dialogs}
    </div>
  );
}
