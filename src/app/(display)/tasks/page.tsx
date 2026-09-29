"use client";

import { MemberDayAgenda } from "@/calendar/MemberDayAgenda";
import { TasksScreen } from "@/tasks/TasksScreen";

export default function TasksPage() {
  return <TasksScreen MemberDay={MemberDayAgenda} />;
}
