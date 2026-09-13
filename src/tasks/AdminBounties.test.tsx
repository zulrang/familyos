// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { AdminBounties } from "./AdminBounties";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("parents can manage available, completed, and retired Bounty definitions", async () => {
  const user = userEvent.setup();
  const initialDefinitions = [
    {
      kind: "bounty",
      id: "a".repeat(32),
      lineage: "1".repeat(32),
      type: "chore",
      title: "Wash car",
      stars: 4,
      recurrence: { kind: "once" },
      revision: 0,
      retiredAt: null,
    },
    {
      kind: "bounty",
      id: "b".repeat(32),
      lineage: "2".repeat(32),
      type: "chore",
      title: "Clean windows",
      stars: 7,
      recurrence: { kind: "once" },
      revision: 2,
      retiredAt: null,
    },
    {
      kind: "bounty",
      id: "c".repeat(32),
      lineage: "3".repeat(32),
      type: "chore",
      title: "Old errand",
      stars: 1,
      recurrence: { kind: "once" },
      revision: 1,
      retiredAt: "2026-09-12",
    },
  ];
  const claims = [
    {
      kind: "claimed-bounty",
      claim: {
        id: "d".repeat(32),
        offering: { kind: "once", definition: initialDefinitions[1]?.id },
        member: "dad",
        scheduledOn: "2026-09-10",
        title: "Clean windows",
        stars: 7,
      },
      revision: 1,
      state: {
        kind: "completed",
        completion: {
          id: "e".repeat(32),
          claim: "d".repeat(32),
          by: "dad",
          at: "2026-09-10T12:00:00Z",
          creditedStars: 7,
        },
      },
    },
    {
      kind: "claimed-bounty",
      claim: {
        id: "f".repeat(32),
        offering: { kind: "once", definition: initialDefinitions[2]?.id },
        member: "dad",
        scheduledOn: "2026-09-11",
        title: "Old errand",
        stars: 1,
      },
      revision: 0,
      state: { kind: "unfinished" },
    },
  ];
  const afterEdit = initialDefinitions.map((definition) =>
    definition.id === "a".repeat(32)
      ? { ...definition, title: "Polish car", stars: 8, revision: 1 }
      : definition,
  );
  const afterConcurrentEdit = afterEdit.map((definition) =>
    definition.id === "b".repeat(32)
      ? { ...definition, stars: 9, revision: 3 }
      : definition,
  );
  const afterRetire = afterConcurrentEdit.map((definition) =>
    definition.id === "b".repeat(32)
      ? { ...definition, revision: 4, retiredAt: "2026-09-13" }
      : definition,
  );
  const taskReads = [
    initialDefinitions,
    afterEdit,
    afterConcurrentEdit,
    afterRetire,
  ];
  const postResponses = [
    Response.json({
      receipt: { status: "accepted", definition: afterEdit[0] },
    }),
    Response.json(
      { error: "This Bounty changed. Refresh before saving." },
      { status: 409 },
    ),
    Response.json({
      receipt: { status: "accepted", definition: afterRetire[1] },
    }),
  ];
  const commands: Record<string, unknown>[] = [];
  let taskRead = 0;
  let postResponse = 0;
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const command = JSON.parse(String(init.body)) as Record<string, unknown>;
      commands.push(command);
      const response = postResponses[postResponse];
      postResponse += 1;
      if (!response) throw new Error("Unexpected Bounty command");
      return response;
    }
    if (url.endsWith("/members")) {
      return Response.json({
        members: [
          { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        ],
        version: 1,
      });
    }
    const bountyDefinitions = taskReads[taskRead];
    taskRead += 1;
    if (!bountyDefinitions) throw new Error("Unexpected Bounty refresh");
    return Response.json({
      definitions: [],
      bountyDefinitions,
      bountyClaims: claims,
      events: [],
      originalEvents: [],
      corrections: [],
      adjustments: [],
      balances: [],
      today: "2026-09-13",
    });
  });

  render(<AdminBounties />);
  expect(
    await screen.findByRole("heading", { name: "Wash car" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "Clean windows" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Old errand" })).toBeVisible();
  expect(screen.getByText("Completed")).toBeVisible();
  expect(screen.getByText("Retired")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Edit Wash car" }));
  expect(screen.queryByLabelText(/date/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/time/i)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "   " },
  });
  await user.click(screen.getByRole("button", { name: "Save Bounty" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a title");
  expect(screen.getByLabelText("Title")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Polish car" },
  });
  fireEvent.change(screen.getByLabelText("Stars per completion"), {
    target: { value: "8" },
  });
  await user.click(screen.getByRole("button", { name: "Save Bounty" }));
  expect(
    await screen.findByRole("heading", { name: "Polish car" }),
  ).toBeVisible();
  expect(commands[0]).toMatchObject({
    kind: "edit-bounty",
    definition: "a".repeat(32),
    revision: 0,
    draft: { title: "Polish car", stars: 8 },
  });

  await user.click(
    screen.getByRole("button", { name: "Retire Clean windows" }),
  );
  await waitFor(() =>
    expect(commands[1]).toMatchObject({
      kind: "retire-bounty",
      definition: "b".repeat(32),
      revision: 2,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This Bounty changed",
  );
  expect(
    screen.getByRole("button", { name: "Retry retire Clean windows" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel retry" }));
  await user.click(screen.getByRole("button", { name: "Refresh Bounties" }));
  expect(
    await screen.findByRole("button", { name: "Retire Clean windows" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Retire Clean windows" }),
  );
  await waitFor(() => expect(commands).toHaveLength(3));
  expect(commands[2]?.requestId).not.toBe(commands[1]?.requestId);
  expect(commands[2]?.revision).toBe(3);
  expect(
    screen.queryByRole("button", { name: "Edit Clean windows" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("Retired")).toHaveLength(2);
});

test("one retirement command owns duplicate taps and blocks refresh until it settles", async () => {
  const definition = {
    kind: "bounty",
    id: "a".repeat(32),
    lineage: "1".repeat(32),
    type: "chore",
    title: "Wash car",
    stars: 4,
    recurrence: { kind: "once" },
    revision: 0,
    retiredAt: null,
  };
  const taskReads = [
    [definition],
    [{ ...definition, revision: 1, retiredAt: "2026-09-13" }],
  ];
  let resolveRetirement: ((response: Response) => void) | undefined;
  const retirementResponse = new Promise<Response>((resolve) => {
    resolveRetirement = resolve;
  });
  let taskRead = 0;
  let commands = 0;
  let confirmations = 0;
  vi.stubGlobal("confirm", () => {
    confirmations += 1;
    return true;
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      commands += 1;
      return retirementResponse;
    }
    if (url.endsWith("/members")) {
      return Response.json({
        members: [
          { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        ],
        version: 1,
      });
    }
    const bountyDefinitions = taskReads[taskRead];
    taskRead += 1;
    if (!bountyDefinitions) throw new Error("Unexpected Bounty refresh");
    return Response.json({
      definitions: [],
      bountyDefinitions,
      bountyClaims: [],
      events: [],
      originalEvents: [],
      corrections: [],
      adjustments: [],
      balances: [],
      today: "2026-09-13",
    });
  });

  render(<AdminBounties />);
  await screen.findByRole("heading", { name: "Wash car" });
  const retire = screen.getByRole("button", { name: "Retire Wash car" });
  const refresh = screen.getByRole("button", { name: "Refresh Bounties" });
  act(() => {
    retire.click();
    retire.click();
    refresh.click();
  });
  expect(confirmations).toBe(1);
  expect(commands).toBe(1);
  expect(refresh).toBeDisabled();

  resolveRetirement?.(
    Response.json({
      receipt: {
        status: "accepted",
        definition: taskReads[1]?.[0],
      },
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Bounty retired");
  expect(taskRead).toBe(2);
});

test("recurring management status follows the current interval while retaining older history", async () => {
  const definitions = [
    {
      kind: "bounty",
      id: "a".repeat(32),
      lineage: "1".repeat(32),
      type: "chore",
      title: "Daily reset",
      stars: 2,
      recurrence: {
        kind: "recurring",
        startsOn: "2026-09-10",
        cadence: { kind: "daily" },
      },
      revision: 0,
      retiredAt: null,
    },
    {
      kind: "bounty",
      id: "b".repeat(32),
      lineage: "2".repeat(32),
      type: "chore",
      title: "Monday bins",
      stars: 3,
      recurrence: {
        kind: "recurring",
        startsOn: "2026-09-15",
        cadence: { kind: "weekly", days: ["mon"] },
      },
      revision: 0,
      retiredAt: null,
    },
  ];
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/members")) {
      return Response.json({
        members: [{ id: "dad", name: "Dad", status: "active" }],
        version: 1,
      });
    }
    return Response.json({
      definitions: [],
      bountyDefinitions: definitions,
      bountyClaims: [
        {
          kind: "claimed-bounty",
          claim: {
            id: "c".repeat(32),
            offering: {
              kind: "recurring",
              definition: definitions[0]?.id,
              intervalStart: "2026-09-12",
            },
            member: "dad",
            scheduledOn: "2026-09-12",
            title: "Daily reset",
            stars: 2,
          },
          revision: 0,
          state: { kind: "unfinished" },
        },
      ],
      events: [],
      originalEvents: [],
      corrections: [],
      adjustments: [],
      balances: [],
      today: "2026-09-13",
    });
  });

  render(<AdminBounties />);
  const daily = (
    await screen.findByRole("heading", {
      name: "Daily reset",
    })
  ).closest("article");
  const future = screen
    .getByRole("heading", { name: "Monday bins" })
    .closest("article");
  expect(daily).not.toBeNull();
  expect(future).not.toBeNull();
  if (!daily || !future) return;
  expect(within(daily).getByText("Available")).toBeVisible();
  expect(within(daily).getByText(/Daily from 2026-09-10/)).toBeVisible();
  expect(within(daily).getByText(/1 historical claim/)).toBeVisible();
  expect(within(future).getByText("Waiting")).toBeVisible();
  expect(within(future).getByText(/Mon from 2026-09-15/)).toBeVisible();
});
