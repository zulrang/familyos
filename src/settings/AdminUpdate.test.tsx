// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AdminUpdate } from "./AdminUpdate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("starts an update and prevents repeat clicks", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
    init.method === "GET"
      ? Promise.resolve(Response.json({ available: true }))
      : new Promise<Response>((resolve) => {
          finish = resolve;
        }),
  );
  render(<AdminUpdate />);
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  finish(Response.json({ ok: true }, { status: 202 }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Refresh this page",
  );
  expect(screen.getByRole("button", { name: "Update started" })).toBeDisabled();
});

test("shows a launch error and allows retry", async () => {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
    init.method === "GET"
      ? Response.json({ available: true })
      : Response.json({ error: "Could not start update." }, { status: 500 }),
  );
  render(<AdminUpdate />);
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not start update.",
  );
  expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
});

test("hides Update while checking and when already current", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  render(<AdminUpdate />);
  expect(
    screen.queryByRole("button", { name: "Update" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish(Response.json({ available: false }));
  });
  expect(
    screen.queryByRole("heading", { name: "Update FamilyOS" }),
  ).not.toBeInTheDocument();
});

test("offers a retry when checking fails and reveals an available update", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ error: "Could not check for updates." }, { status: 503 }),
  );
  render(<AdminUpdate />);
  const retry = await screen.findByRole("button", { name: "Retry check" });
  expect(
    screen.queryByRole("button", { name: "Update" }),
  ).not.toBeInTheDocument();
  vi.stubGlobal("fetch", async () => Response.json({ available: true }));
  fireEvent.click(retry);
  expect(await screen.findByRole("button", { name: "Update" })).toBeEnabled();
});
