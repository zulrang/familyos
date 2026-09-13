// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  const definitions = [
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
        offering: { kind: "once", definition: definitions[1]?.id },
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
        offering: { kind: "once", definition: definitions[2]?.id },
        member: "dad",
        scheduledOn: "2026-09-11",
        title: "Old errand",
        stars: 1,
      },
      revision: 0,
      state: { kind: "unfinished" },
    },
  ];
  const commands: Record<string, unknown>[] = [];
  let retireFailures = 1;
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const command = JSON.parse(String(init.body)) as Record<string, unknown>;
      commands.push(command);
      const definition = definitions.find(
        (row) => row.id === command.definition,
      );
      if (definition && command.kind === "edit-bounty") {
        const draft = command.draft as { title: string; stars: number };
        definition.title = draft.title;
        definition.stars = draft.stars;
        definition.revision += 1;
      }
      if (definition && command.kind === "retire-bounty") {
        if (retireFailures > 0) {
          retireFailures -= 1;
          return Response.json(
            { error: "This Bounty changed. Refresh before saving." },
            { status: 409 },
          );
        }
        definition.retiredAt = "2026-09-13";
        definition.revision += 1;
      }
      return Response.json({ receipt: { status: "accepted", definition } });
    }
    if (url.endsWith("/members")) {
      return Response.json({
        members: [
          { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        ],
        version: 1,
      });
    }
    return Response.json({
      definitions: [],
      bountyDefinitions: definitions,
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
  expect(screen.getByText("Retry retire")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel retry" }));
  expect(
    screen.getByRole("button", { name: "Retire Clean windows" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Retire Clean windows" }),
  );
  await waitFor(() => expect(commands).toHaveLength(3));
  expect(commands[2]?.requestId).not.toBe(commands[1]?.requestId);
  expect(
    screen.queryByRole("button", { name: "Edit Clean windows" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("Retired")).toHaveLength(2);
});
