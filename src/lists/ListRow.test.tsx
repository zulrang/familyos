// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { ListRow } from "./ListRow";

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
});
