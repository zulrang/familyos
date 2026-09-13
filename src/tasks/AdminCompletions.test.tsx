// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { HouseholdMember } from "@/members/members";
import { AdminCompletions } from "./AdminCompletions";
import type { CompletionCorrection, TaskAdminRead } from "./admin-types";
import type {
  Instant,
  LegacyTaskDefinition,
  LocalDate,
  TaskEvent,
  TaskId,
} from "./types";

const members: HouseholdMember[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
];

function definition(id: string, title: string): LegacyTaskDefinition {
  return {
    id: id as LegacyTaskDefinition["id"],
    lineage: `${id}-lineage` as LegacyTaskDefinition["lineage"],
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
    bountyDefinitions: [],
    bountyClaims: [],
    bountyCompletions: [],
    bountyCompletionCorrections: [],
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
        onSaved={() => {}}
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
        onSaved={() => {}}
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
        onSaved={() => {}}
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
        onSaved={() => {}}
        query="zzz"
      />,
    );
    expect(screen.getByText("No matching completions.")).toBeVisible();
  });
});

test("Bounty correction actions are state-specific and submit only once", async () => {
  const user = userEvent.setup();
  let finishRequest: ((response: Response) => void) | undefined;
  const request = new Promise<Response>((resolve) => {
    finishRequest = resolve;
  });
  const fetch = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) => request,
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("confirm", () => true);
  const onSaved = vi.fn();
  const completion = {
    id: "c".repeat(32),
    claim: "b".repeat(32) as never,
    by: "dad",
    at: "2026-09-08T12:00:00Z",
    creditedStars: 4,
    creditProvenance: "recorded" as const,
  };
  const data: TaskAdminRead = {
    ...read([], []),
    bountyClaims: [
      {
        kind: "claimed-bounty",
        claim: {
          id: "b".repeat(32) as never,
          offering: { kind: "once", definition: "a".repeat(32) as TaskId },
          member: "dad",
          scheduledOn: "2026-09-08" as LocalDate,
          title: "Wash car" as never,
          stars: 4 as never,
        },
        revision: 1 as never,
        state: {
          kind: "completed",
          completion: completion as never,
          creditedTo: "dad",
          correction: null,
        },
      },
    ],
    bountyCompletions: [completion as never],
  };

  render(
    <AdminCompletions
      data={data}
      members={members}
      onSaved={onSaved}
      query=""
    />,
  );
  expect(screen.getByRole("heading", { name: "Wash car" })).toBeVisible();
  expect(screen.getAllByText(/4 Stars/)).toHaveLength(2);
  await user.click(
    screen.getByRole("button", { name: "Correct Bounty completion" }),
  );
  expect(screen.getByRole("option", { name: "Undo completion" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Reassign credit" })).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "Restore completion" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Reason"), "Tapped accidentally");
  const submit = screen.getByRole("button", {
    name: "Record Bounty correction",
  });
  await user.dblClick(submit);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(submit).toBeDisabled();
  const command = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(command).toMatchObject({
    kind: "undo-bounty-completion",
    claim: "b".repeat(32),
    revision: 1,
    completion: "c".repeat(32),
    predecessor: null,
    reason: "Tapped accidentally",
  });
  finishRequest?.(Response.json({ receipt: { status: "accepted" } }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  vi.unstubAllGlobals();
});
