// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ListRow } from "./ListRow";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function ControlledListRow({
  label,
  initial = false,
}: {
  label: string;
  initial?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return <ListRow label={label} checked={checked} onToggle={setChecked} />;
}

describe("ListRow", () => {
  test("clicking a row marks the item complete with strikethrough", async () => {
    const user = userEvent.setup();
    render(<ControlledListRow label="Milk" />);

    const row = screen.getByRole("button", { name: "Milk" });
    expect(screen.getByText("Milk")).toHaveStyle({
      textDecoration: "none",
    });

    await user.click(row);
    expect(screen.getByText("Milk")).toHaveStyle({
      textDecoration: "line-through",
    });
  });

  test("context menu edits the item without checking it", async () => {
    const user = userEvent.setup();
    const edits: string[] = [];
    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <ListRow
          label="Milk"
          checked={checked}
          onToggle={setChecked}
          onEdit={() => edits.push("edit")}
        />
      );
    }
    render(<Harness />);

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });

    expect(edits).toEqual(["edit"]);
    expect(screen.getByText("Milk")).toHaveStyle({
      textDecoration: "none",
    });
  });

  test("press-and-hold edits the item on release without checking it", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <ListRow
          label="Milk"
          checked={checked}
          onToggle={setChecked}
          onEdit={() => edits.push("edit")}
        />
      );
    }
    render(<Harness />);
    const row = screen.getByRole("button", { name: "Milk" });

    fireEvent.pointerDown(row, { clientX: 0, clientY: 0 });
    await vi.advanceTimersByTimeAsync(500);
    expect(edits).toEqual([]);

    fireEvent.pointerUp(row);
    expect(edits).toEqual(["edit"]);
    expect(screen.getByText("Milk")).toHaveStyle({
      textDecoration: "none",
    });
  });

  test("press-and-hold still edits after the pointer leaves the row", async () => {
    vi.useFakeTimers();
    const edits: string[] = [];
    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <ListRow
          label="Milk"
          checked={checked}
          onToggle={setChecked}
          onEdit={() => edits.push("edit")}
        />
      );
    }
    render(<Harness />);
    const row = screen.getByRole("button", { name: "Milk" });

    fireEvent.pointerDown(row, { clientX: 0, clientY: 0, pointerId: 1 });
    await vi.advanceTimersByTimeAsync(500);
    fireEvent.pointerLeave(row);
    fireEvent.pointerUp(row, { pointerId: 1 });

    expect(edits).toEqual(["edit"]);
    expect(screen.getByText("Milk")).toHaveStyle({
      textDecoration: "none",
    });
  });
});
