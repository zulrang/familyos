// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { AdminTaskForm } from "./AdminTaskForm";
import type { LegacyTaskDefinition, LocalDate } from "./types";

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

test("an assigned Chore converts to a Bounty with Bounty-only schedule fields", async () => {
  const user = userEvent.setup();
  const task = {
    id: "a".repeat(32),
    lineage: "1".repeat(32),
    title: "Bins",
    type: "chore",
    recurrence: { kind: "daily" },
    assignment: { kind: "fixed", member: "dad" },
    time: "09:00",
    stars: 3,
    retiredAt: null,
  } as LegacyTaskDefinition;
  let resolveSave: ((response: Response) => void) | undefined;
  const save = new Promise<Response>((resolve) => {
    resolveSave = resolve;
  });
  const commands: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    commands.push(JSON.parse(String(init.body)));
    return save;
  });
  const onSaved = vi.fn();

  render(
    <AdminTaskForm
      task={task}
      members={[{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }]}
      today={"2026-09-13" as LocalDate}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );
  await user.selectOptions(screen.getByLabelText("Work mode"), "bounty");
  expect(screen.queryByLabelText("Assignment")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/time/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^date$/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Weekdays" }));
  expect(screen.getByLabelText("Starting date")).toHaveValue("2026-09-13");
  await user.click(screen.getByRole("button", { name: "Fri" }));

  const submit = screen.getByRole("button", { name: "Save task" });
  act(() => {
    submit.click();
    submit.click();
  });
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    kind: "replace-definition",
    source: { kind: "assigned", definition: task.id },
    replacement: {
      kind: "bounty",
      type: "chore",
      title: "Bins",
      stars: 3,
      recurrence: {
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["fri"] },
      },
    },
  });
  resolveSave?.(Response.json({ receipt: { status: "accepted" } }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test("assigned task creation offers only fixed and rotation assignment", () => {
  render(
    <AdminTaskForm
      members={[{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }]}
      today={"2026-09-13" as LocalDate}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const assignment = screen.getByLabelText("Assignment");
  expect(assignment).toHaveValue("fixed");
  expect(screen.getByRole("option", { name: "One member" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Take turns" })).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "Open to anyone" }),
  ).not.toBeInTheDocument();
});
