// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { AdminMembers } from "@/members/AdminMembers";
import { AdminRewards } from "@/rewards/AdminRewards";
import { AdminEditorScreen } from "@/shared/AdminEditorScreen";
import { AdminStars } from "@/tasks/AdminStars";
import { AdminTasks } from "@/tasks/AdminTasks";

// jsdom lacks native dialog methods; browser checks cover modality and scrolling.
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

const cases = [
  {
    Component: AdminTasks,
    section: "Tasks",
    edit: "Edit Dishes",
    heading: "Edit task",
    create: "New task",
    newHeading: "New task",
    field: "Title",
    save: "Save task",
  },
  {
    Component: AdminMembers,
    section: "Members",
    edit: "Edit Ellie",
    heading: "Edit member",
    create: "Add member",
    newHeading: "Add a member",
    field: "Name",
    save: "Save member",
  },
  {
    Component: AdminRewards,
    section: "Rewards",
    edit: "Edit reward",
    heading: "Edit reward",
    create: "Add reward",
    newHeading: "Add reward",
    field: "Name",
    save: "Save reward",
  },
];

function serveData() {
  const member = {
    id: "ellie",
    name: "Ellie",
    status: "active",
    color: "#a9d8d2",
  };
  const task = {
    id: "a".repeat(32),
    lineage: "b".repeat(32),
    title: "Dishes",
    type: "chore",
    recurrence: { kind: "daily" },
    assignment: { kind: "open" },
    time: null,
    stars: 1,
    retiredAt: null,
  };
  const reward = {
    id: "c".repeat(32),
    name: "Movie",
    description: "",
    cost: 5,
    icon: "star",
    revision: 1,
    retiredAt: null,
  };
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      const command = JSON.parse(String(options.body));
      if (url.endsWith("/members")) member.name = command.name;
      if (url.endsWith("/tasks")) task.title = command.draft.title;
      if (url.endsWith("/rewards")) reward.name = command.draft.name;
      return Response.json({ ok: true });
    }
    if (url.endsWith("/members"))
      return Response.json({ members: [member], version: 1 });
    if (url.endsWith("/rewards")) return Response.json({ rewards: [reward] });
    return Response.json({
      definitions: [task],
      today: "2026-09-10",
      originalEvents: [],
      events: [],
      corrections: [],
      balances: [],
      adjustments: [],
    });
  });
}

test.each(
  cases,
)("$section keeps its list beneath the drawer and returns after cancel or save", async ({
  Component,
  section,
  edit,
  heading,
  create,
  newHeading,
  field,
  save,
}) => {
  serveData();
  render(<Component />);
  fireEvent.click(await screen.findByRole("button", { name: edit }));
  expect(
    screen.getByRole("heading", { name: heading, level: 1 }),
  ).toHaveFocus();
  expect(
    screen.queryByRole("heading", { name: section, level: 1 }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("article")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `Refresh ${section.toLowerCase()}` }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(field), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: `Back to ${section.toLowerCase()}` }),
  );
  fireEvent.click(await screen.findByRole("button", { name: edit }));
  expect(screen.getByLabelText(field)).not.toHaveValue("Unsaved");
  fireEvent.change(screen.getByLabelText(field), {
    target: { value: "Updated" },
  });
  fireEvent.click(screen.getByRole("button", { name: save }));
  expect(
    await screen.findByRole("heading", { name: "Updated" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: create }));
  expect(
    screen.getByRole("heading", { name: newHeading, level: 1 }),
  ).toHaveFocus();
  expect(screen.queryByRole("article")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    await screen.findByRole("heading", { name: section, level: 1 }),
  ).toBeInTheDocument();
});

test("takeover prevents leaving while saving and supports dismissal when idle", () => {
  function FormScreen({ busy }: { busy: boolean }) {
    const [open, setOpen] = useState(true);
    return open ? (
      <AdminEditorScreen
        title="Example form"
        backLabel="Examples"
        busy={busy}
        onBack={() => setOpen(false)}
      >
        <input aria-label="Example field" />
      </AdminEditorScreen>
    ) : (
      <p>Example list</p>
    );
  }
  const view = render(<FormScreen busy />);
  expect(
    screen.getByRole("button", { name: "Back to examples" }),
  ).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<FormScreen busy={false} />);
  expect(
    screen.getByRole("button", { name: "Back to examples" }),
  ).toBeEnabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByText("Example list")).toBeInTheDocument();
});

test("star adjustments open in a drawer above the balances and discard unsaved input on close", async () => {
  serveData();
  render(<AdminStars />);
  const adjust = await screen.findByRole("button", { name: "Adjust balance" });
  expect(screen.queryByLabelText("Number of stars")).not.toBeInTheDocument();
  fireEvent.click(adjust);
  expect(
    screen.getByRole("dialog", { name: "Adjust stars" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Manage stars" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Ellie’s Star Adjustments" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Number of stars"), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to stars" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Adjust balance" }));
  expect(screen.getByLabelText("Number of stars")).toHaveValue(1);
});
