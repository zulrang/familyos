// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { HouseholdMember } from "@/members/members";
import { AdminCompletions } from "./AdminCompletions";
import type { CompletionCorrection, TaskAdminRead } from "./admin-types";
import {
  type LegacyBountyCompletionCarrier,
  parseLegacyBountyCarrierId,
  parseLegacyBountyCarrierRevision,
} from "./legacy-bounty-carrier-types";
import {
  type Instant,
  type LegacyTaskDefinition,
  type LocalDate,
  parseBountyCommandReceipt,
  parseBountyCorrectionId,
  parseClaimRevision,
  parseCompletionId,
  parseInstant,
  parseLocalDate,
  parseStarAmount,
  parseTaskId,
  parseTaskTitle,
  type TaskEvent,
  type TaskId,
} from "./types";

const members: HouseholdMember[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
  { id: "former", name: "Former", status: "retired" },
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
    legacyBountyCompletionCarriers: [],
    events,
    originalEvents: events,
    legacyBountyArchiveEvents: [],
    corrections,
    adjustments: [],
    balances: [],
    today: "2026-09-09" as TaskAdminRead["today"],
  };
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Invalid earlier Bounty UI fixture");
  return value;
}

function earlierBountyCarrier(): LegacyBountyCompletionCarrier {
  const carrier = required(parseLegacyBountyCarrierId("legacy-carrier:dishes"));
  const completion = {
    id: required(parseCompletionId("legacy-completion:dishes")),
    carrier,
    by: "dad",
    at: required(parseInstant("2026-09-03T14:00:00Z")),
    creditedStars: required(parseStarAmount(5)),
    creditProvenance: "recorded" as const,
  };
  const correction = required(parseBountyCorrectionId("legacy-reassignment"));
  return {
    kind: "legacy-bounty-completion-carrier",
    id: carrier,
    sourceTask: required(parseTaskId("legacy-dishes")),
    sourceWindow: required(parseLocalDate("2026-09-03")),
    definition: required(parseTaskId("legacy-dishes")),
    offering: {
      kind: "legacy",
      definition: required(parseTaskId("legacy-dishes")),
      sourceWindow: required(parseLocalDate("2026-09-03")),
      intervalStart: null,
    },
    title: required(parseTaskTitle("Wash old dishes")),
    revision: required(parseLegacyBountyCarrierRevision(1)),
    history: [
      {
        id: correction,
        carrier,
        completion: completion.id,
        predecessor: null,
        kind: "reassign",
        fromMember: "dad",
        toMember: "ellie",
        creditedStars: completion.creditedStars,
        creditProvenance: completion.creditProvenance,
        reason: "Ellie did this work",
        at: required(parseInstant("2026-09-03T15:00:00Z")),
      },
    ],
    state: {
      kind: "completed",
      effectiveCompletion: completion,
      creditedTo: "ellie",
      correction,
    },
  };
}

function releasedEarlierBountyCarrier(): LegacyBountyCompletionCarrier {
  const completed = earlierBountyCarrier();
  if (completed.state.kind !== "completed")
    throw new Error("Invalid completed earlier Bounty fixture");
  const correction = required(parseBountyCorrectionId("legacy-undo"));
  return {
    ...completed,
    revision: required(parseLegacyBountyCarrierRevision(2)),
    history: [
      ...completed.history,
      {
        id: correction,
        carrier: completed.id,
        completion: completed.state.effectiveCompletion.id,
        predecessor: completed.state.correction,
        kind: "undo",
        fromMember: completed.state.creditedTo,
        toMember: null,
        creditedStars: completed.state.effectiveCompletion.creditedStars,
        creditProvenance: completed.state.effectiveCompletion.creditProvenance,
        reason: "Completion did not happen",
        at: required(parseInstant("2026-09-03T16:00:00Z")),
      },
    ],
    state: {
      kind: "released",
      undoneCompletion: completed.state.effectiveCompletion,
      correction,
    },
  };
}

function completedBountyRead(): TaskAdminRead {
  const completionReceipt = parseBountyCommandReceipt({
    status: "accepted",
    result: {
      kind: "completed",
      completion: {
        id: "c".repeat(32),
        claim: "b".repeat(32),
        by: "dad",
        at: "2026-09-08T12:00:00Z",
        creditedStars: 4,
        creditProvenance: "recorded",
      },
    },
  });
  const claimReceipt = parseBountyCommandReceipt({
    status: "accepted",
    result: {
      kind: "claimed",
      claim: {
        id: "b".repeat(32),
        offering: { kind: "once", definition: "a".repeat(32) },
        member: "dad",
        scheduledOn: "2026-09-08",
        title: "Wash car",
        stars: 4,
      },
      revision: 1,
    },
  });
  if (
    !completionReceipt ||
    !("result" in completionReceipt) ||
    completionReceipt.result.kind !== "completed" ||
    !claimReceipt ||
    !("result" in claimReceipt) ||
    claimReceipt.result.kind !== "claimed"
  )
    throw new Error("Invalid Bounty completion UI fixture");
  const completion = completionReceipt.result.completion;
  return {
    ...read([], []),
    bountyClaims: [
      {
        kind: "claimed-bounty",
        claim: claimReceipt.result.claim,
        revision: claimReceipt.result.revision,
        state: {
          kind: "completed",
          completion,
          creditedTo: "dad",
          correction: null,
        },
      },
    ],
    bountyCompletions: [completion],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminCompletions", () => {
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
  render(
    <AdminCompletions
      data={completedBountyRead()}
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
});

test("a lost response retries the exact Bounty correction command", async () => {
  const user = userEvent.setup();
  let calls = 0;
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) throw new Error("response lost");
      return Response.json({ receipt: { status: "already-applied" } });
    },
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("confirm", () => true);
  const onSaved = vi.fn();
  render(
    <AdminCompletions
      data={completedBountyRead()}
      members={members}
      onSaved={onSaved}
      query=""
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Correct Bounty completion" }),
  );
  await user.selectOptions(screen.getByLabelText("Correction"), "reassign");
  await user.selectOptions(screen.getByLabelText("Credit to"), "ellie");
  await user.type(screen.getByLabelText("Reason"), "Ellie did it");
  await user.click(
    screen.getByRole("button", { name: "Record Bounty correction" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Cannot reach FamilyOS",
  );
  expect(screen.getByLabelText("Correction")).toBeDisabled();
  expect(screen.getByLabelText("Credit to")).toBeDisabled();
  expect(screen.getByLabelText("Reason")).toBeDisabled();
  const firstBody = fetch.mock.calls[0]?.[1]?.body;
  await user.click(
    screen.getByRole("button", { name: "Retry Bounty correction" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[1]?.body).toBe(firstBody);
});

test("only Restore is offered while the original Claim remains reopened", async () => {
  const user = userEvent.setup();
  const data = completedBountyRead();
  const completed = data.bountyClaims[0];
  const revision = parseClaimRevision(2);
  const correction = parseBountyCorrectionId("undo-correction");
  if (
    !completed ||
    completed.state.kind !== "completed" ||
    !revision ||
    !correction
  )
    throw new Error("Invalid reopened UI fixture");
  data.bountyClaims = [
    {
      ...completed,
      revision,
      state: {
        kind: "reopened",
        undoneCompletion: completed.state.completion,
        correction,
      },
    },
  ];
  render(
    <AdminCompletions
      data={data}
      members={members}
      onSaved={() => {}}
      query=""
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Correct Bounty completion" }),
  );
  expect(
    screen.getByRole("option", { name: "Restore completion" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "Undo completion" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Reassign credit" }),
  ).not.toBeInTheDocument();
});

test("earlier Bounty corrections offer Undo and reassign once, never Restore", async () => {
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
  const data = read([], []);
  data.legacyBountyCompletionCarriers = [earlierBountyCarrier()];
  const onSaved = vi.fn();
  render(
    <AdminCompletions
      data={data}
      members={members}
      onSaved={onSaved}
      query=""
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Wash old dishes" }),
  ).toBeVisible();
  expect(screen.getByText(/Earlier Bounty completion/)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Correct earlier Bounty completion" }),
  );
  expect(screen.getByRole("option", { name: "Undo completion" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Reassign credit" })).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "Restore completion" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Reason"), "Imported record was wrong");
  const submit = screen.getByRole("button", {
    name: "Record earlier Bounty correction",
  });
  await user.dblClick(submit);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(submit).toBeDisabled();
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
    kind: "undo-legacy-bounty-completion",
    carrier: "legacy-carrier:dishes",
    revision: 1,
    completion: "legacy-completion:dishes",
    predecessor: "legacy-reassignment",
    reason: "Imported record was wrong",
  });
  finishRequest?.(Response.json({ receipt: { status: "accepted" } }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});

test("a lost response retries the exact earlier Bounty reassignment", async () => {
  const user = userEvent.setup();
  let calls = 0;
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) throw new Error("response lost");
      return Response.json({ receipt: { status: "already-applied" } });
    },
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("confirm", () => true);
  const data = read([], []);
  data.legacyBountyCompletionCarriers = [earlierBountyCarrier()];
  const onSaved = vi.fn();
  render(
    <AdminCompletions
      data={data}
      members={members}
      onSaved={onSaved}
      query=""
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Correct earlier Bounty completion" }),
  );
  await user.selectOptions(screen.getByLabelText("Correction"), "reassign");
  await user.selectOptions(screen.getByLabelText("Credit to"), "former");
  await user.type(screen.getByLabelText("Reason"), "Former did this work");
  await user.click(
    screen.getByRole("button", { name: "Record earlier Bounty correction" }),
  );
  await screen.findByRole("alert");
  const firstBody = fetch.mock.calls[0]?.[1]?.body;
  expect(JSON.parse(String(firstBody))).toMatchObject({
    kind: "reassign-legacy-bounty-completion",
    carrier: "legacy-carrier:dishes",
    revision: 1,
    completion: "legacy-completion:dishes",
    predecessor: "legacy-reassignment",
    member: "former",
    reason: "Former did this work",
  });

  await user.click(
    screen.getByRole("button", { name: "Retry earlier Bounty correction" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[1]?.body).toBe(firstBody);
});

test("an undone earlier completion keeps history without offering Restore", () => {
  const data = read([], []);
  data.legacyBountyCompletionCarriers = [releasedEarlierBountyCarrier()];
  render(
    <AdminCompletions
      data={data}
      members={members}
      onSaved={() => {}}
      query=""
    />,
  );

  expect(screen.getByText(/historical work released/)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Wash old dishes" }).closest("article"),
  ).toHaveTextContent("Completion did not happen");
  expect(
    screen.queryByRole("button", { name: "Correct earlier Bounty completion" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Restore completion" }),
  ).not.toBeInTheDocument();
});
