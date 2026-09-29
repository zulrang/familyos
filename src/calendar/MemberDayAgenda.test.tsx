// @vitest-environment jsdom

import {
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("reads the complete household day and switches members without changing the event source", async () => {
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
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json(read),
  );
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<MemberDayAgenda {...base} memberId="dad" />);
  expect(screen.getByText("Loading calendar…")).toBeTruthy();
  expect(await screen.findByText("Dad appointment")).toBeTruthy();
  expect(screen.getByText("Dinner")).toBeTruthy();
  expect(screen.queryByText("Ellie class")).toBeNull();
  const url = String(fetchMock.mock.calls[0]?.[0]);
  expect(new URL(url, "http://localhost").searchParams.get("from")).toBe(
    "2026-09-29T04:00:00.000Z",
  );
  expect(new URL(url, "http://localhost").searchParams.get("to")).toBe(
    "2026-09-30T04:00:00.000Z",
  );

  view.rerender(<MemberDayAgenda {...base} memberId="ellie" />);
  expect(screen.getByText("Ellie class")).toBeTruthy();
  expect(screen.getByText("Dinner")).toBeTruthy();
  expect(screen.queryByText("Dad appointment")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  view.rerender(
    <MemberDayAgenda
      {...base}
      memberId="ellie"
      day={new Date("2026-09-30T16:00:00Z")}
    />,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const nextUrl = String(fetchMock.mock.calls[1]?.[0]);
  expect(new URL(nextUrl, "http://localhost").searchParams.get("from")).toBe(
    "2026-09-30T04:00:00.000Z",
  );
});

test("shows saved data, an empty day, and a recoverable read error", async () => {
  const fetchMock = vi
    .fn(
      async (_input: RequestInfo | URL): Promise<Response> =>
        Response.json({ stale: false, events: [] }),
    )
    .mockResolvedValueOnce(Response.json({ stale: true, events: [] }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ stale: false, events: [] }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<MemberDayAgenda {...base} memberId="dad" />);
  expect(
    await screen.findByText("Showing saved calendar events."),
  ).toBeTruthy();
  expect(screen.getByText("No calendar events today.")).toBeTruthy();

  view.rerender(
    <MemberDayAgenda
      {...base}
      memberId="dad"
      day={new Date("2026-09-30T16:00:00Z")}
    />,
  );
  expect(
    await screen.findByText("Could not load today’s calendar."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.getByText("No calendar events today.")).toBeTruthy(),
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
