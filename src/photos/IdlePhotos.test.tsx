// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { IDLE_DIM_CHANGED } from "@/shared/idle-dim";
import { NavRail } from "@/shared/NavRail";
import { IdlePhotos } from "./IdlePhotos";
import type { PhotosStatus } from "./photos";

vi.mock("next/navigation", () => ({ usePathname: () => "/lists" }));

const ready: PhotosStatus = {
  state: "ready",
  sourceName: "Family",
  pickerUrl: "https://photos.google.com/picker",
  photos: [
    { id: "1", src: "/photo1" },
    { id: "2", src: "/photo2" },
  ],
  pollAfterMs: 60_000,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function PreviousScreen() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Count {count}
    </button>
  );
}

async function setup(status: PhotosStatus = ready) {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async () => Response.json(status));
  render(
    <IdlePhotos idleDimAfterMs={30_000}>
      <NavRail />
      <PreviousScreen />
    </IdlePhotos>,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
}

const overlay = () =>
  screen.queryByRole("button", { name: "Return to previous screen" });

test("Sleep immediately enters idle and waking preserves the screen and restarts its timeout", async () => {
  await setup();
  fireEvent.click(screen.getByText("Count 0"));
  const sleep = screen.getByRole("button", { name: "Sleep" });
  expect(screen.queryByRole("link", { name: "Sleep" })).toBeNull();
  fireEvent.pointerDown(sleep);
  fireEvent.pointerUp(sleep);
  fireEvent.click(sleep);
  expect(overlay()).toBeVisible();
  expect(screen.getByText("Count 1").parentElement).toHaveAttribute("inert");
  const wake = screen.getByRole("button", {
    name: "Return to previous screen",
  });
  fireEvent.pointerDown(wake);
  fireEvent.pointerUp(wake);
  fireEvent.click(wake);
  expect(overlay()).not.toBeInTheDocument();
  expect(screen.getByText("Count 1")).toBeVisible();
  expect(screen.getByText("Count 1").parentElement).not.toHaveAttribute(
    "inert",
  );
  await act(() => vi.advanceTimersByTimeAsync(29_999));
  expect(overlay()).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(overlay()).toBeVisible();
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
  expect(overlay()).toBeVisible();
  fireEvent.keyDown(window, { key: "Enter" });
  expect(overlay()).not.toBeInTheDocument();
  expect(screen.getByText("Count 1")).toBeVisible();
});

test("idle playback advances and a full tap restores the preserved screen without clicking through", async () => {
  await setup();
  fireEvent.click(screen.getByText("Count 0"));
  await act(() => vi.advanceTimersByTimeAsync(29_999));
  expect(overlay()).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(overlay()).toBeVisible();
  expect(screen.getByRole("img")).toHaveAttribute("src", "/photo1");
  expect(screen.getByText("Count 1").parentElement).toHaveAttribute("inert");
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByRole("img")).toHaveAttribute("src", "/photo2");
  const wake = screen.getByRole("button", {
    name: "Return to previous screen",
  });
  fireEvent.pointerDown(wake);
  expect(overlay()).toBeVisible();
  fireEvent.pointerUp(wake);
  fireEvent.click(wake);
  expect(overlay()).not.toBeInTheDocument();
  expect(screen.getByText("Count 1")).toBeVisible();
  expect(screen.getByText("Count 1").parentElement).not.toHaveAttribute(
    "inert",
  );
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(overlay()).toBeVisible();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(overlay()).not.toBeInTheDocument();
});

test("activity postpones playback and saved timeout changes persist after waking", async () => {
  await setup();
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  fireEvent.pointerMove(document.body);
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(overlay()).not.toBeInTheDocument();
  act(() =>
    window.dispatchEvent(
      new CustomEvent(IDLE_DIM_CHANGED, {
        detail: { idleDimAfterMs: 60_000, idleDimTo: 10 },
      }),
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(59_999));
  expect(overlay()).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(1));
  fireEvent.click(
    screen.getByRole("button", { name: "Return to previous screen" }),
  );
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(overlay()).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(overlay()).toBeVisible();
});

test.each<PhotosStatus>([
  { state: "disconnected" },
  { ...ready, photos: [] },
])("keeps the previous screen usable without photos: $state", async (status) => {
  await setup(status);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(overlay()).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Count 0"));
  expect(screen.getByText("Count 1")).toBeVisible();
  vi.stubGlobal("fetch", async () => Response.json(ready));
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(overlay()).toBeVisible();
});
