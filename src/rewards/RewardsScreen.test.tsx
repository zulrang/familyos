// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RewardsScreen } from "./RewardsScreen";
import { parseStarCost, type RewardsRead } from "./types";

const cost = parseStarCost(2);
if (!cost) throw Error("cost");
const data: RewardsRead = {
  familyName: "Family",
  members: [
    { id: "a", name: "Alex", status: "active", color: "#a9d8d2" },
    { id: "b", name: "Bailey", status: "active", color: "#dccfea" },
  ],
  balances: [
    { member: "a", balance: 4 },
    { member: "b", balance: 0 },
  ],
  rewards: [
    {
      id: "a".repeat(32),
      name: "Movie",
      description: "Choose a film",
      cost,
      icon: "image",
      revision: 1,
      retiredAt: null,
    },
  ],
  goals: [],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("selecting a member updates affordability, and goals can be chosen at zero balance", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async (_url, init) =>
      Response.json(init?.method === "POST" ? { spend: null } : data),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<RewardsScreen />);
  await screen.findByText("Rewards for Alex");
  fireEvent.click(screen.getByRole("button", { name: /Bailey/ }));
  expect(screen.getByText("Rewards for Bailey")).toBeVisible();
  expect(screen.getByRole("button", { name: "Spend" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Set as goal" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (call) => call[1]?.body && JSON.parse(call[1].body).member === "b",
      ),
    ).toBe(true),
  );
});
test("opening and canceling a visual Spend never deducts stars", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(data));
  vi.stubGlobal("fetch", fetcher);
  render(<RewardsScreen />);
  await screen.findByText("Rewards for Alex");
  fireEvent.click(screen.getByRole("button", { name: "Spend" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("These stars buy this")).toBeVisible();
  expect(within(dialog).getAllByRole("img", { name: "2 stars" })).toHaveLength(
    2,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep saving" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every((call) => call[1]?.method === "GET")).toBe(
    true,
  );
});
test("retry after a lost Spend response uses the same request ID", async () => {
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return Response.json(data);
      writes.push(init.body);
      if (writes.length === 1) throw Error("Connection lost");
      return Response.json({ spend: {} });
    }),
  );
  render(<RewardsScreen />);
  await screen.findByText("Rewards for Alex");
  fireEvent.click(screen.getByRole("button", { name: "Spend" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose reward" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Choose reward" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0]).toBe(writes[1]);
  expect(JSON.parse(writes[0])).toMatchObject({
    kind: "spend",
    member: "a",
    revision: 1,
  });
});
