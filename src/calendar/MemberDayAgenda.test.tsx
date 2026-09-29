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
import { MemberDayAgenda } from "./MemberDayAgenda";
import type { CalendarRead } from "./types";

const day = new Date("2026-09-29T16:00:00Z");
const base = { day, timeZone: "America/New_York", calendarId: "family" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("keeps the last successful day visible when refresh fails, then replaces it after the next poll", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const first: CalendarRead = {
    stale: false,
    events: [
      {
        id: "practice",
        title: "Swim practice",
        allDay: false,
        startMs: Date.parse("2026-09-29T13:00:00Z"),
        endMs: Date.parse("2026-09-29T14:00:00Z"),
        participantIds: ["dad"],
        expectedVersion: "1",
      },
    ],
  };
  const refreshed: CalendarRead = {
    stale: false,
    events: [
      {
        id: "lesson",
        title: "Music lesson",
        allDay: false,
        startMs: Date.parse("2026-09-29T15:00:00Z"),
        endMs: Date.parse("2026-09-29T16:00:00Z"),
        participantIds: ["dad"],
        expectedVersion: "2",
      },
    ],
  };
  let remote: CalendarRead | null = first;
  vi.stubGlobal("fetch", async () => {
    return remote ? Response.json(remote) : new Response(null, { status: 503 });
  });

  render(<MemberDayAgenda {...base} memberId="dad" />);
  expect(await screen.findByText("Swim practice")).toBeTruthy();
  remote = null;
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText("Swim practice")).toBeTruthy();
  expect(screen.getByText("Showing saved calendar events.")).toBeTruthy();

  remote = refreshed;
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  expect(await screen.findByText("Music lesson")).toBeTruthy();
  expect(screen.queryByText("Swim practice")).toBeNull();
  expect(screen.queryByText("Showing saved calendar events.")).toBeNull();
});

test("shows the selected member and household events, then the next household day", async () => {
  const read: CalendarRead = {
    stale: false,
    events: [
      {
        id: "shared",
        title: "Dinner",
        allDay: false,
        startMs: Date.parse("2026-09-29T22:00:00Z"),
        endMs: Date.parse("2026-09-29T23:00:00Z"),
        participantIds: [],
        expectedVersion: "1",
      },
      {
        id: "dad",
        title: "Dad appointment",
        allDay: false,
        startMs: Date.parse("2026-09-29T13:00:00Z"),
        endMs: Date.parse("2026-09-29T14:00:00Z"),
        participantIds: ["dad"],
        expectedVersion: "1",
      },
      {
        id: "ellie",
        title: "Ellie class",
        allDay: true,
        startMs: Date.parse("2026-09-29T04:00:00Z"),
        endMs: Date.parse("2026-09-30T04:00:00Z"),
        participantIds: ["ellie"],
        expectedVersion: "1",
      },
    ],
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const params = new URL(String(input), "http://localhost").searchParams;
    const from = params.get("from");
    const to = params.get("to");
    if (
      from === "2026-09-29T04:00:00.000Z" &&
      to === "2026-09-30T04:00:00.000Z"
    ) {
      return Response.json(read);
    }
    if (
      from === "2026-09-30T04:00:00.000Z" &&
      to === "2026-10-01T04:00:00.000Z"
    ) {
      return Response.json({
        stale: false,
        events: [
          {
            id: "tomorrow",
            title: "Tomorrow breakfast",
            allDay: false,
            startMs: Date.parse("2026-09-30T12:00:00Z"),
            endMs: Date.parse("2026-09-30T13:00:00Z"),
            participantIds: ["ellie"],
            expectedVersion: "1",
          },
        ],
      } satisfies CalendarRead);
    }
    throw new Error(`Unexpected calendar range: ${from} to ${to}`);
  });
  const view = render(<MemberDayAgenda {...base} memberId="dad" />);
  expect(screen.getByText("Loading calendar…")).toBeTruthy();
  expect(await screen.findByText("Dad appointment")).toBeTruthy();
  expect(screen.getByText("Dinner")).toBeTruthy();
  expect(screen.queryByText("Ellie class")).toBeNull();

  view.rerender(<MemberDayAgenda {...base} memberId="ellie" />);
  expect(screen.getByText("Ellie class")).toBeTruthy();
  expect(screen.getByText("Dinner")).toBeTruthy();
  expect(screen.queryByText("Dad appointment")).toBeNull();

  view.rerender(
    <MemberDayAgenda
      {...base}
      memberId="ellie"
      day={new Date("2026-09-30T16:00:00Z")}
    />,
  );
  expect(await screen.findByText("Tomorrow breakfast")).toBeTruthy();
  expect(screen.queryByText("Ellie class")).toBeNull();
  expect(screen.queryByText("Dinner")).toBeNull();
});

test("shows saved data, an empty day, and a recoverable read error", async () => {
  let recover = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const from = new URL(String(input), "http://localhost").searchParams.get(
      "from",
    );
    if (from === "2026-09-29T04:00:00.000Z") {
      return Response.json({ stale: true, events: [] });
    }
    return recover
      ? Response.json({ stale: false, events: [] })
      : new Response(null, { status: 503 });
  });
  const view = render(<MemberDayAgenda {...base} memberId="dad" />);
  expect(
    await screen.findByText("Showing saved calendar events."),
  ).toBeTruthy();
  expect(screen.getByText("No calendar events today.")).toBeTruthy();

  view.rerender(
    <MemberDayAgenda
      {...base}
      key="2026-09-30"
      memberId="dad"
      day={new Date("2026-09-30T16:00:00Z")}
    />,
  );
  expect(
    await screen.findByText("Could not load today’s calendar."),
  ).toBeTruthy();
  recover = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Loading calendar…")).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByText("No calendar events today.")).toBeTruthy(),
  );
});

test("rejects malformed calendar data with a recoverable error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () =>
    Response.json({
      stale: false,
      events: [
        {
          id: "bad",
          title: "Broken",
          participantIds: ["dad"],
          startMs: "tomorrow",
        },
      ],
    }),
  );
  render(<MemberDayAgenda {...base} memberId="dad" />);
  expect(
    await screen.findByText("Could not load today’s calendar."),
  ).toBeTruthy();
  expect(screen.queryByText("Broken")).toBeNull();
});

test("guides the family when no calendar is selected", () => {
  render(<MemberDayAgenda {...base} calendarId={null} memberId="dad" />);
  expect(
    screen.getByText("Choose a family calendar in Settings."),
  ).toBeTruthy();
});
