// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import {
  type BountyRecurrenceDraft,
  BountyRecurrenceEditor,
  parseBountyRecurrenceDraft,
} from "./BountyRecurrenceEditor";
import { parseLocalDate } from "./types";

afterEach(cleanup);

function localDate(raw: string) {
  const value = parseLocalDate(raw);
  if (!value) throw new Error("invalid test date");
  return value;
}

const today = localDate("2026-09-13");

function RecurrenceHarness({ initial }: { initial: BountyRecurrenceDraft }) {
  const [draft, setDraft] = useState(initial);
  const recurrence = parseBountyRecurrenceDraft(draft);
  return (
    <>
      <BountyRecurrenceEditor
        draft={draft}
        defaultStartsOn={today}
        onChange={setDraft}
      />
      <output aria-label="Validated recurrence">
        {recurrence ? JSON.stringify(recurrence) : "invalid"}
      </output>
    </>
  );
}

describe("BountyRecurrenceEditor", () => {
  test("Once has no date or time input; Daily starts on the Household date", async () => {
    const user = userEvent.setup();
    render(<RecurrenceHarness initial={{ kind: "once" }} />);

    expect(screen.getByRole("button", { name: "Once" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("Starting date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/time/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      JSON.stringify({ kind: "once" }),
    );

    await user.click(screen.getByRole("button", { name: "Daily" }));

    expect(screen.getByLabelText("Starting date")).toHaveValue("2026-09-13");
    expect(screen.queryByLabelText(/time/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      JSON.stringify({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "daily" },
      }),
    );

    await user.clear(screen.getByLabelText("Starting date"));
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      "invalid",
    );
  });

  test("selected weekdays require at least one distinct day", async () => {
    const user = userEvent.setup();
    render(<RecurrenceHarness initial={{ kind: "once" }} />);

    await user.click(screen.getByRole("button", { name: "Weekdays" }));

    expect(screen.getByLabelText("Starting date")).toHaveValue("2026-09-13");
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      "invalid",
    );
    const monday = screen.getByRole("button", { name: "Mon" });
    const wednesday = screen.getByRole("button", { name: "Wed" });
    await user.click(monday);
    await user.click(wednesday);

    expect(monday).toHaveAttribute("aria-pressed", "true");
    expect(wednesday).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      JSON.stringify({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["mon", "wed"] },
      }),
    );

    await user.click(monday);
    expect(monday).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      JSON.stringify({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "weekly", days: ["wed"] },
      }),
    );
  });

  test("Monthly accepts calendar days 1 through 28", async () => {
    const user = userEvent.setup();
    render(<RecurrenceHarness initial={{ kind: "once" }} />);

    await user.click(screen.getByRole("button", { name: "Monthly" }));

    const day = screen.getByLabelText("Day of month");
    expect(day).toHaveAttribute("min", "1");
    expect(day).toHaveAttribute("max", "28");
    expect(day).toHaveAttribute("step", "1");
    expect(day).toHaveValue(1);
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      JSON.stringify({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "monthly", day: 1 },
      }),
    );

    await user.clear(day);
    await user.type(day, "28");
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      JSON.stringify({
        kind: "recurring",
        startsOn: "2026-09-13",
        cadence: { kind: "monthly", day: 28 },
      }),
    );

    fireEvent.change(day, { target: { value: "29" } });
    expect(screen.getByLabelText("Validated recurrence")).toHaveTextContent(
      "invalid",
    );
  });
});
