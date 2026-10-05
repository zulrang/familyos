// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NavRail } from "./NavRail";

vi.mock("next/navigation", () => ({ usePathname: () => "/lists" }));

afterEach(cleanup);

test("marks only the current section as the current page", () => {
  render(<NavRail />);
  expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Calendar" })).not.toHaveAttribute(
    "aria-current",
  );
});

test("tints the current section's slab in that section's tone", () => {
  render(<NavRail />);
  expect(screen.getByRole("link", { name: "Lists" }).style.background).toBe(
    "var(--member-sand-soft)",
  );
  expect(screen.getByRole("link", { name: "Tasks" }).style.background).toBe(
    "transparent",
  );
});
