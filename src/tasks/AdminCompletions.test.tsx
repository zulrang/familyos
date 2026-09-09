// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { HouseholdMember } from "@/members/members";
import { AdminCompletions } from "./AdminCompletions";
import type { CompletionCorrection, TaskAdminRead } from "./admin-types";
import type {
  Instant,
  LocalDate,
  TaskDefinition,
  TaskEvent,
  TaskId,
} from "./types";

const members: HouseholdMember[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
];

function definition(id: string, title: string): TaskDefinition {
  return {
    id: id as TaskDefinition["id"],
    lineage: `${id}-lineage` as TaskDefinition["lineage"],
    title,
    type: "chore",
    recurrence: { kind: "daily" },
    assignment: { kind: "open" },
    time: null,
    stars: 1,
    retiredAt: null,
  };
}

function completed(task: string, window: string, by: string): TaskEvent {
  return {
    kind: "completed",
    task: task as TaskId,
    window: window as LocalDate,
    by,
    at: "2026-09-08T12:00:00Z" as Instant,
  };
}

function correction(
  id: string,
  task: string,
  window: string,
  by: string | null,
): CompletionCorrection {
  return {
    id,
    task: task as CompletionCorrection["task"],
    window: window as CompletionCorrection["window"],
    by,
    reason: "Wrong person tapped",
    at: "2026-09-08T13:00:00Z" as CompletionCorrection["at"],
    previous: null,
  };
}

function read(
  events: TaskEvent[],
  corrections: CompletionCorrection[],
): TaskAdminRead {
  return {
    definitions: [definition("dishes", "Dishes")],
    events,
    originalEvents: events,
    corrections,
    adjustments: [],
    balances: [],
    today: "2026-09-09" as TaskAdminRead["today"],
  };
}

describe("AdminCompletions", () => {
  afterEach(cleanup);

  test("search matches the corrected assignee, not only the original", () => {
    render(
      <AdminCompletions
        data={read(
          [completed("dishes", "2026-09-08", "dad")],
          [correction("c1", "dishes", "2026-09-08", "ellie")],
        )}
        members={members}
        query="Ellie"
      />,
    );
    expect(screen.getByRole("heading", { name: "Dishes" })).toBeVisible();
  });

  test("search matches an undone completion via the displayed word", () => {
    render(
      <AdminCompletions
        data={read(
          [completed("dishes", "2026-09-08", "dad")],
          [correction("c1", "dishes", "2026-09-08", null)],
        )}
        members={members}
        query="undone"
      />,
    );
    expect(screen.getByRole("heading", { name: "Dishes" })).toBeVisible();
  });

  test("original doer stays findable after a reassignment", () => {
    render(
      <AdminCompletions
        data={read(
          [completed("dishes", "2026-09-08", "dad")],
          [correction("c1", "dishes", "2026-09-08", "ellie")],
        )}
        members={members}
        query="Dad"
      />,
    );
    expect(screen.getByRole("heading", { name: "Dishes" })).toBeVisible();
  });

  test("a non-matching query shows the empty state", () => {
    render(
      <AdminCompletions
        data={read(
          [completed("dishes", "2026-09-08", "dad")],
          [correction("c1", "dishes", "2026-09-08", "ellie")],
        )}
        members={members}
        query="zzz"
      />,
    );
    expect(screen.getByText("No matching completions.")).toBeVisible();
  });
});
