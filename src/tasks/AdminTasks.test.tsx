// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AdminTasks } from "./AdminTasks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("filters by member and type and hides past one-time tasks by default", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/members")) {
      return Response.json({
        members: [
          {
            id: "ellie",
            name: "Ellie",
            status: "active",
            color: "#a9d8d2",
          },
          {
            id: "max",
            name: "Max",
            status: "active",
            color: "#f6c9c5",
          },
        ],
        version: 1,
      });
    }
    return Response.json({
      definitions: [
        {
          id: "a".repeat(32),
          lineage: "1".repeat(32),
          title: "Old homework",
          type: "chore",
          recurrence: { kind: "once", date: "2026-09-14" },
          assignment: { kind: "fixed", member: "ellie" },
          time: null,
          stars: 1,
          retiredAt: null,
        },
        {
          id: "b".repeat(32),
          lineage: "2".repeat(32),
          title: "Shared bedtime",
          type: "routine",
          recurrence: { kind: "daily" },
          assignment: { kind: "rotation", order: ["ellie", "max"] },
          time: null,
          stars: 1,
          retiredAt: null,
        },
        {
          id: "c".repeat(32),
          lineage: "3".repeat(32),
          title: "Ellie's dishes",
          type: "chore",
          recurrence: { kind: "weekly", days: ["mon"] },
          assignment: { kind: "fixed", member: "ellie" },
          time: null,
          stars: 1,
          retiredAt: null,
        },
        {
          id: "d".repeat(32),
          lineage: "4".repeat(32),
          title: "Max's project",
          type: "chore",
          recurrence: { kind: "once", date: "2026-09-16" },
          assignment: { kind: "fixed", member: "max" },
          time: null,
          stars: 1,
          retiredAt: null,
        },
        {
          id: "e".repeat(32),
          lineage: "5".repeat(32),
          title: "Retired old task",
          type: "chore",
          recurrence: { kind: "once", date: "2026-09-13" },
          assignment: { kind: "fixed", member: "ellie" },
          time: null,
          stars: 1,
          retiredAt: "2026-09-14",
        },
      ],
      today: "2026-09-15",
      originalEvents: [],
      events: [],
      corrections: [],
      balances: [],
      adjustments: [],
    });
  });

  render(<AdminTasks />);

  expect(
    await screen.findByRole("heading", { name: "Shared bedtime" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Old homework" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Max's project" }),
  ).toBeInTheDocument();

  await user.click(
    screen.getByLabelText("Include retired tasks and old versions"),
  );
  expect(
    screen.queryByRole("heading", { name: "Retired old task" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByLabelText("Include past one-time tasks"));
  expect(
    screen.getByRole("heading", { name: "Old homework" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Retired old task" }),
  ).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Household member"), "ellie");
  expect(
    screen.queryByRole("heading", { name: "Max's project" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Ellie's dishes" }),
  ).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Type"), "routine");
  expect(
    screen.getByRole("heading", { name: "Shared bedtime" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Ellie's dishes" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Old homework" }),
  ).not.toBeInTheDocument();
});
