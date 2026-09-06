// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PhotosScreen } from "./PhotosScreen";
import type { PhotosStatus } from "./photos";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function respond(status: PhotosStatus) {
  vi.stubGlobal("fetch", async () => Response.json(status));
}

test("connect displays the Google code and verification link", async () => {
  respond({ state: "disconnected" });
  render(<PhotosScreen />);
  const connect = await screen.findByRole("button", {
    name: "Connect Google Photos",
  });
  respond({
    state: "authorizing",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://www.google.com/device",
    expiresAt: Date.now() + 1800_000,
    pollAfterMs: 5000,
  });
  fireEvent.click(connect);
  expect(await screen.findByText("ABCD-EFGH")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Open Google sign-in" }),
  ).toHaveAttribute("href", "https://www.google.com/device");
  expect(screen.getByText("Waiting for authorization…")).toBeVisible();
});

test("slideshow advances, pauses, wraps and opens album settings", async () => {
  const photos = [
    { id: "1", src: "/api/photos/image?id=1" },
    { id: "2", src: "/api/photos/image?id=2" },
  ];
  respond({
    state: "ready",
    sourceName: "Family",
    settingsUrl: "https://photos.google.com/device",
    photos,
    pollAfterMs: 600_000,
  });
  render(<PhotosScreen />);
  await screen.findByRole("img", { name: "Family" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("img", { name: "Family" })).toHaveAttribute(
    "src",
    photos[1].src,
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("img", { name: "Family" })).toHaveAttribute(
    "src",
    photos[0].src,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pause slideshow" }));
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.getByRole("img", { name: "Family" })).toHaveAttribute(
    "src",
    photos[0].src,
  );
  fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByRole("img", { name: "Family" })).toHaveAttribute(
    "src",
    photos[1].src,
  );
  fireEvent.click(screen.getByRole("button", { name: "Photo settings" }));
  expect(
    screen.getByRole("link", { name: "Choose album in Google Photos" }),
  ).toHaveAttribute("href", "https://photos.google.com/device");
  expect(screen.queryByRole("img", { name: "Family" })).not.toBeInTheDocument();
});

test("empty selections do not enable slideshow controls", async () => {
  respond({
    state: "ready",
    sourceName: "Family",
    settingsUrl: "https://photos.google.com/device",
    photos: [],
    pollAfterMs: 600_000,
  });
  render(<PhotosScreen />);
  expect(await screen.findByRole("button", { name: "Next" })).toBeDisabled();
  expect(screen.getByText(/No photos available yet/)).toBeVisible();
});

test("disconnect removes the slideshow and returns to Connect", async () => {
  respond({
    state: "ready",
    sourceName: "Family",
    settingsUrl: "https://photos.google.com/device",
    photos: [{ id: "1", src: "/api/photos/image?id=1" }],
    pollAfterMs: 600_000,
  });
  render(<PhotosScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Photo settings" }),
  );
  respond({ state: "disconnected" });
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Photos" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Connect Google Photos" }),
    ).toBeVisible(),
  );
  expect(screen.queryByRole("img", { name: "Family" })).not.toBeInTheDocument();
});
