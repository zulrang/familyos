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

function KeyboardScreen() {
  const [keys, setKeys] = useState(0);
  return (
    <>
      <input
        aria-label="Keyboard field"
        onKeyDown={(event) => {
          if (event.key === "Enter") setKeys((value) => value + 1);
        }}
      />
      <output>Keys {keys}</output>
    </>
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

test.each<{
  status: PhotosStatus;
  message: RegExp;
  destination: "/settings" | "/photos";
}>([
  {
    status: { state: "unconfigured" },
    message: /connect Google in Settings/i,
    destination: "/settings",
  },
  {
    status: { state: "disconnected" },
    message: /choose photos/i,
    destination: "/photos",
  },
  {
    status: {
      state: "selecting",
      pickerUrl: "https://photos.google.com/picker",
      pollAfterMs: 60_000,
    },
    message: /finish choosing photos/i,
    destination: "/photos",
  },
  {
    status: { ...ready, photos: [] },
    message: /no photos are available yet/i,
    destination: "/photos",
  },
])("manual Sleep explains unavailable photos: $status.state", async ({
  status,
  message,
  destination,
}) => {
  await setup(status);
  fireEvent.click(screen.getByText("Count 0"));
  fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
  const feedback = screen.getByRole("dialog", { name: "Sleep unavailable" });
  expect(feedback).toHaveTextContent(message);
  const nextStep = screen.getByRole("link", {
    name: /open (Settings|Photos)/i,
  });
  expect(nextStep).toHaveAttribute("href", destination);
  fireEvent.pointerDown(nextStep);
  fireEvent.keyDown(nextStep, { key: "Tab" });
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toBeVisible();
  expect(screen.getByText("Count 1")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Return to previous screen" }),
  );
  expect(
    screen.queryByRole("dialog", { name: "Sleep unavailable" }),
  ).toBeNull();
  expect(screen.getByText("Count 1")).toBeVisible();
});

test("manual Sleep gives feedback while photos load or fail, while automatic idle stays quiet", async () => {
  vi.useFakeTimers();
  let rejectLoad: (error: Error) => void = () => {};
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((_resolve, reject) => {
        rejectLoad = reject;
      }),
  );
  render(
    <IdlePhotos idleDimAfterMs={30_000}>
      <NavRail />
      <PreviousScreen />
    </IdlePhotos>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toHaveTextContent(/checking photos/i);
  await act(async () => rejectLoad(new Error("private backend detail")));
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toHaveTextContent(/photos are unavailable/i);
  expect(screen.queryByText("private backend detail")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Return to previous screen" }),
  );
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("manual Sleep waits for photos, then starts playback without losing the request", async () => {
  vi.useFakeTimers();
  let finishLoad: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        finishLoad = resolve;
      }),
  );
  render(
    <IdlePhotos idleDimAfterMs={30_000}>
      <NavRail />
      <PreviousScreen />
    </IdlePhotos>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toBeVisible();
  await act(async () => finishLoad(Response.json(ready)));
  expect(overlay()).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "Sleep unavailable" }),
  ).toBeNull();
  expect(document.activeElement).toBe(overlay());
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Return to previous screen" }),
    { key: "Enter" },
  );
  expect(overlay()).toBeNull();
  expect(screen.getByRole("button", { name: "Count 0" })).toBeVisible();
});

test("Escape dismisses Sleep feedback without changing the current screen", async () => {
  await setup({ state: "unconfigured" });
  fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
  fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
  const feedback = screen.getByRole("dialog", { name: "Sleep unavailable" });
  fireEvent.keyDown(screen.getByRole("link", { name: "Open Settings" }), {
    key: "Escape",
  });
  expect(feedback).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Count 1" })).toBeVisible();
});

test("manual Sleep explains a failed photo without exposing the current screen", async () => {
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "Sleep" }));
  fireEvent.error(screen.getByRole("img", { name: "Family" }));
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toHaveTextContent(/photo could not load/i);
  const action = screen.getByRole("link", { name: "Open Photos" });
  expect(action).toHaveAttribute("href", "/photos");
  expect(document.activeElement).toBe(action);
  fireEvent.keyDown(action, { key: "Tab" });
  expect(
    screen.getByRole("dialog", { name: "Sleep unavailable" }),
  ).toBeVisible();
});

test("automatic idle without photos leaves the visible screen's keyboard usable", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async () => Response.json({ state: "disconnected" }));
  render(
    <IdlePhotos idleDimAfterMs={30_000}>
      <KeyboardScreen />
    </IdlePhotos>,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Keyboard field" }), {
    key: "Enter",
  });
  expect(screen.getByText("Keys 1")).toBeVisible();
});
