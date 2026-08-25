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
                expectedVersion: "v1",
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
          expectedVersion: "v1",
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
    await user.click(
      await screen.findByRole("button", { name: "Add event Fri" }),
    );
    expect(
      await screen.findByRole("heading", { name: "New Event" }),
    ).toBeInTheDocument();
    const date = screen.getByDisplayValue("2026-08-21");
    expect(date).toHaveAttribute("type", "date");
  });
});

describe("CalendarScreen outage cache", () => {
  const practice: CalEvent = {
    id: "ev-1",
    title: "Practice",
    allDay: true,
    startMs: fromDateOnly("2026-08-19", "America/New_York"),
    endMs: fromDateOnly("2026-08-20", "America/New_York"),
    participantIds: [],
    expectedVersion: "v1",
  };

  test("stale Calendar events stay visible and cannot be mutated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.includes("/api/events")) {
          return json({ events: [practice], stale: true });
        }
        return json({ error: "read-only" }, 503);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CalendarScreen />);

    expect(
      await screen.findByRole("button", { name: "Practice" }),
    ).toBeVisible();
    expect(
      screen.getByText("Google is unavailable. Calendar is read-only."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add event Fri" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Practice" }));
    expect(screen.queryByRole("heading", { name: "Event" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "New Event" })).toBeNull();
  });

  test("disconnected Displays still show matching cached Calendar events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json({ ...settings, signedIn: false });
        }
        if (method === "GET" && url.includes("/api/events")) {
          return json({ events: [practice], stale: true });
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CalendarScreen />);

    expect(
      await screen.findByRole("button", { name: "Practice" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  test("stale Calendar becomes writable again after Google recovers", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    let stale = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (url.includes("/api/events")) {
          return json({ events: [practice], stale });
        }
        return json({ error: "unhandled" }, 500);
      }),
    );
    render(<CalendarScreen />);

    expect(
      await screen.findByText("Google is unavailable. Calendar is read-only."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();

    stale = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(await screen.findByRole("button", { name: "Add" })).toBeVisible();
    expect(
      screen.queryByText("Google is unavailable. Calendar is read-only."),
    ).toBeNull();
  });

  test("a slower stale poll does not overwrite a live recovery", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    let mode: "stale" | "hang" | "live" = "stale";
    const hung: ((res: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (url.includes("/api/events")) {
          if (mode === "stale") {
            return json({ events: [practice], stale: true });
          }
          if (mode === "live") {
            return json({ events: [practice], stale: false });
          }
          return new Promise<Response>((resolve) => {
            hung.push(resolve);
          });
        }
        return json({ error: "unhandled" }, 500);
      }),
    );
    render(<CalendarScreen />);

    expect(
      await screen.findByText("Google is unavailable. Calendar is read-only."),
    ).toBeInTheDocument();

    mode = "hang";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(hung.length).toBeGreaterThan(0);

    mode = "live";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(await screen.findByRole("button", { name: "Add" })).toBeVisible();

    await act(async () => {
      for (const resolve of hung) {
        resolve(json({ events: [practice], stale: true }));
      }
    });

    expect(screen.getByRole("button", { name: "Add" })).toBeVisible();
    expect(
      screen.queryByText("Google is unavailable. Calendar is read-only."),
    ).toBeNull();
  });
});

describe("CalendarScreen stale writes", () => {
  const practice: CalEvent = {
    id: "ev-1",
    title: "Practice",
    allDay: true,
    startMs: fromDateOnly("2026-08-19", "America/New_York"),
    endMs: fromDateOnly("2026-08-20", "America/New_York"),
    participantIds: [],
    expectedVersion: "v1",
  };
  const current: CalEvent = {
    ...practice,
    title: "Recital",
    expectedVersion: "v2",
  };

  test("a stale save reloads the current event instead of keeping the write", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.includes("/api/events")) {
          return json({ events: [practice], stale: false });
        }
        if (method === "PATCH") {
          return json({ error: "version", event: current }, 409);
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CalendarScreen />);

    await user.click(await screen.findByRole("button", { name: "Practice" }));
    const title = await screen.findByPlaceholderText("Title");
    await user.clear(title);
    await user.type(title, "Stolen");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Recital" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stolen" })).toBeNull();
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Recital");
    expect(
      screen.getByText(
        "This event changed on another Display. Reloaded — try again.",
      ),
    ).toBeInTheDocument();
  });

  test("a stale delete leaves the current event on the wall", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.includes("/api/events")) {
          return json({ events: [practice], stale: false });
        }
        if (method === "DELETE") {
          return json({ error: "version", event: current }, 409);
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CalendarScreen />);

    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(
      await screen.findByRole("button", { name: "Recital" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Recital");
    expect(
      screen.getByText(
        "This event changed on another Display. Reloaded — try again.",
      ),
    ).toBeInTheDocument();
  });

  test("a conflict without a current event does not remove the event", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.includes("/api/events")) {
          return json({ events: [practice], stale: false });
        }
        if (method === "PATCH") {
          return json({ error: "version" }, 409);
        }
        return json({ error: "unhandled" }, 500);
      }),
    );
    render(<CalendarScreen />);

    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Event" })).toBeInTheDocument();
  });

  test("an open editor submits the version from when it opened, not a later poll", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-08-19T15:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let listed: CalEvent[] = [practice];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.includes("/api/events")) {
          return json({ events: listed, stale: false });
        }
        if (method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            expectedVersion?: string;
          };
          if (body.expectedVersion !== "v1") {
            return json(
              { error: "lost-update", got: body.expectedVersion },
              500,
            );
          }
          return json({ error: "version", event: current }, 409);
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CalendarScreen />);

    await user.click(await screen.findByRole("button", { name: "Practice" }));
    expect(await screen.findByPlaceholderText("Title")).toHaveValue("Practice");

    listed = [current];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      await screen.findByRole("button", { name: "Recital" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Practice");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "This event changed on another Display. Reloaded — try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Title")).toHaveValue("Recital");
    const patch = fetchMock.mock.calls.find(
      ([, init]) => (init?.method ?? "GET").toUpperCase() === "PATCH",
    );
    expect(patch).toBeTruthy();
    expect(JSON.parse(String(patch?.[1]?.body ?? "{}"))).toMatchObject({
      expectedVersion: "v1",
    });
  });
});
