// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import type { Member } from "@/members/members";
import { type EventDraft, EventSheet } from "./EventSheet";

afterEach(() => {
  cleanup();
});

const roster: Member[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "mom", name: "Mom", status: "active", color: "#f9c0bc" },
  { id: "ex", name: "Ex", status: "retired" },
];

function draft(memberIds: string[] = []): EventDraft {
  return {
    title: "Picnic",
    allDay: false,
    date: "2026-08-25",
    endDate: "2026-08-25",
    startTime: "15:00",
    endTime: "16:00",
    memberIds,
    scope: "this",
  };
}

function Harness({
  members = roster,
  initialIds = [],
}: {
  members?: Member[];
  initialIds?: string[];
}) {
  const [sheet, setSheet] = useState(() => draft(initialIds));
  return (
    <EventSheet
      draft={sheet}
      members={members}
      busy={false}
      onChange={setSheet}
      onClose={() => {}}
      onSave={() => {}}
    />
  );
}

function chip(name: string) {
  return screen.getByRole("button", { name: new RegExp(name) });
}

describe("EventSheet Who", () => {
  test("assigns people with member chips and has no dropdown", () => {
    render(<Harness />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(chip("Dad")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Mom")).toHaveAttribute("aria-pressed", "false");
  });

  test("selecting one person assigns only that member", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip("Dad"));
    expect(chip("Dad")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Mom")).toHaveAttribute("aria-pressed", "false");
  });

  test("selecting several people assigns each chosen member", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(chip("Dad"));
    await user.click(chip("Mom"));
    expect(chip("Dad")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Mom")).toHaveAttribute("aria-pressed", "true");
  });

  test("clearing every chip is a Household Event", async () => {
    const user = userEvent.setup();
    render(<Harness initialIds={["dad"]} />);
    await user.click(chip("Dad"));
    expect(chip("Dad")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Mom")).toHaveAttribute("aria-pressed", "false");
  });

  test("Retired Members already on the event stay assigned and are not newly choosable", async () => {
    const user = userEvent.setup();
    render(<Harness initialIds={["ex"]} />);
    expect(screen.queryByRole("button", { name: /^E Ex$/ })).toBeNull();
    const retired = chip("Ex \\(retired\\)");
    expect(retired).toHaveAttribute("aria-pressed", "true");
    await user.click(chip("Dad"));
    expect(retired).toHaveAttribute("aria-pressed", "true");
    expect(chip("Dad")).toHaveAttribute("aria-pressed", "true");
  });
});
