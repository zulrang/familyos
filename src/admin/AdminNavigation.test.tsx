// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import AdminHome from "@/app/admin/page";
import { AdminShell } from "./AdminShell";

let pathname = "/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

afterEach(() => {
  cleanup();
  pathname = "/admin";
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

test("the admin home links directly to Bounty management", () => {
  render(<AdminHome />);

  expect(screen.getByRole("link", { name: /Bounties/ })).toHaveAttribute(
    "href",
    "/admin/bounties",
  );
});

test("the admin section navigation includes and marks Bounties active", async () => {
  pathname = "/admin/bounties";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "unlocked",
        expiresAt: Date.now() + 60_000,
      }),
    ),
  );

  render(
    <AdminShell>
      <p>Bounty management</p>
    </AdminShell>,
  );

  expect(await screen.findByRole("link", { name: "Bounties" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
