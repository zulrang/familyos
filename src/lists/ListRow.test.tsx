// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { ListRow } from "./ListRow";

afterEach(cleanup);

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
});
