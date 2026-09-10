// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StarAdjustmentForm } from "./AdminStars";

const member = {
  id: "ellie",
  name: "Ellie",
  status: "active" as const,
  color: "#a9d8d2",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function form(balance = 4) {
  render(
    <StarAdjustmentForm
      member={member}
      balance={balance}
      onSaved={() => {}}
      onCancel={() => {}}
      onBusyChange={() => {}}
    />,
  );
}
test("Spend previews zero and rejects insufficient amounts before submitting", () => {
  form();
  fireEvent.click(screen.getByRole("button", { name: "Spend" }));
  fireEvent.change(screen.getByLabelText("Number of stars"), {
    target: { value: "4" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("0 stars");
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Movie" },
  });
  expect(screen.getByRole("button", { name: "Spend stars" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Number of stars"), {
    target: { value: "5" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("Not enough stars");
  expect(screen.getByRole("button", { name: "Spend stars" })).toBeDisabled();
});
test("a lost response retries exactly the same adjustment and locks the payload", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  form();
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Helping" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Grant stars" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Cannot reach FamilyOS",
  );
  expect(screen.getByLabelText("Number of stars")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry adjustment" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    member: "ellie",
    delta: 1,
    reason: "Helping",
  });
});
