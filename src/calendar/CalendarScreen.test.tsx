// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fromDateOnly } from "@/calendar/calendar";
import type { CalEvent } from "@/calendar/types";
import type { PublicSettings } from "@/settings/types";
import { CalendarScreen } from "./CalendarScreen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settings: PublicSettings = {
  familyName: "Test",
  members: [],
  calendarId: "cal-1",
  listIds: [],
  timeZone: "America/New_York",
  signedIn: true,
  googleConfigured: true,
  uiScale: 1,
  configVersion: 1,
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function eventsUrl(calls: [RequestInfo | URL, RequestInit?][]): URL | null {
  const hit = [...calls]
    .reverse()
    .find(([input]) => urlOf(input).includes("/api/events?"));
  return hit ? new URL(urlOf(hit[0]), "http://localhost") : null;
}

function installFetch() {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.includes("/api/events")) {
        return json({ events: [] });
      }
      return json({ error: `unhandled ${method} ${url}` }, 500);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderCalendar() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
  const fetchMock = installFetch();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CalendarScreen />);
  await screen.findByRole("button", { name: "Today" });
  return { fetchMock, user };
}

describe("CalendarScreen Five-Day View", () => {
  test("opens to today plus the next four Household dates", async () => {
    const { fetchMock } = await renderCalendar();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Thu 20")).toBeInTheDocument();
    expect(screen.getByText("Fri 21")).toBeInTheDocument();
    expect(screen.getByText("Sat 22")).toBeInTheDocument();
    expect(screen.getByText("Sun 23")).toBeInTheDocument();
    expect(screen.queryByText("Mon 24")).toBeNull();

    await waitFor(() => {
      const url = eventsUrl(fetchMock.mock.calls);
      expect(url?.searchParams.get("from")).toBe("2026-08-19T04:00:00.000Z");
      expect(url?.searchParams.get("to")).toBe("2026-08-24T04:00:00.000Z");
    });
  });

  test("previous and next move five Household dates and Today restores", async () => {
    const { fetchMock, user } = await renderCalendar();
    await user.click(screen.getByRole("button", { name: "Next five days" }));
    expect(await screen.findByText("Mon 24")).toBeInTheDocument();
    expect(screen.getByText("Fri 28")).toBeInTheDocument();
    expect(screen.queryByText("Wed")).toBeNull();

    await waitFor(() => {
      const url = eventsUrl(fetchMock.mock.calls);
      expect(url?.searchParams.get("from")).toBe("2026-08-24T04:00:00.000Z");
      expect(url?.searchParams.get("to")).toBe("2026-08-29T04:00:00.000Z");
    });

    await user.click(
      screen.getByRole("button", { name: "Previous five days" }),
    );
    expect(await screen.findByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Sun 23")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next five days" }));
    await screen.findByText("Mon 24");
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Sun 23")).toBeInTheDocument();
  });

  test("a slower fetch for an earlier page does not replace the current events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const tz = "America/New_York";
    let releaseFirst: (body: { events: CalEvent[] }) => void = () => {};
    const firstEvents = new Promise<{ events: CalEvent[] }>((resolve) => {
      releaseFirst = resolve;
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.includes("/api/events")) {
          const u = new URL(url, "http://localhost");
          if (u.searchParams.get("from") === "2026-08-19T04:00:00.000Z") {
            const body = await firstEvents;
            if (init?.signal?.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            return json(body);
          }
          return json({
            events: [
              {
                id: "later",
                title: "Later",
                allDay: true,
                startMs: fromDateOnly("2026-08-24", tz),
                endMs: fromDateOnly("2026-08-25", tz),
                participantIds: [],
              },
            ],
          });
        }
        return json({ error: `unhandled ${method} ${url}` }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CalendarScreen />);
    await screen.findByRole("button", { name: "Today" });
    await waitFor(() => {
      expect(eventsUrl(fetchMock.mock.calls)?.searchParams.get("from")).toBe(
        "2026-08-19T04:00:00.000Z",
      );
    });
    await user.click(screen.getByRole("button", { name: "Next five days" }));
    expect(
      await screen.findByRole("button", { name: "Later" }),
    ).toBeInTheDocument();

    releaseFirst({
      events: [
        {
          id: "earlier",
          title: "Earlier",
          allDay: true,
          startMs: fromDateOnly("2026-08-19", tz),
          endMs: fromDateOnly("2026-08-20", tz),
          participantIds: [],
        },
      ],
    });
    await act(async () => {
      await firstEvents;
    });

    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Earlier" })).toBeNull();
  });

  test("creating an event from a column uses that column's Household date", async () => {
    const { user } = await renderCalendar();
    await user.click(screen.getByRole("button", { name: "Add event Fri" }));
    expect(
      await screen.findByRole("heading", { name: "New Event" }),
    ).toBeInTheDocument();
    const date = screen.getByDisplayValue("2026-08-21");
    expect(date).toHaveAttribute("type", "date");
  });
});
