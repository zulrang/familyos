// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { Checkbox } from "./Checkbox";

function ControlledCheckbox({
  label,
  initial = false,
}: {
  label: string;
  initial?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return <Checkbox label={label} checked={checked} onChange={setChecked} />;
}

describe("Checkbox", () => {
  test("clicking toggles the checked state announced to assistive tech", async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox label="Mark milk bought" />);

    const box = screen.getByRole("checkbox", { name: "Mark milk bought" });
    expect(box).not.toBeChecked();

    await user.click(box);
    expect(box).toBeChecked();

    await user.click(box);
    expect(box).not.toBeChecked();
  });
});
