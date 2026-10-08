// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CalEvent } from "@/calendar/types";
import type { PublicSettings } from "@/settings/types";
import type { Occurrence, TasksViewRead } from "@/tasks/types";
import { TodayScreen } from "./TodayScreen";

// jsdom does not implement the native modal dialog methods.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settings: PublicSettings = {
  familyName: "Test",
  members: [
    { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
    { id: "ellie", name: "Ellie", status: "active", color: "#4a90d9" },
    { id: "former", name: "Former", status: "retired" },
  ],
  calendarId: "cal-1",
  listIds: [],
  timeZone: "America/New_York",
  signedIn: true,
  googleConfigured: true,
  uiScale: 1,
  idleDimAfterMs: 300_000,
  idleDimTo: 10,
  configVersion: 1,
};

/** Thu Oct 8 2026, 3:10 PM in New York. */
const NOW = new Date("2026-10-08T19:10:00.000Z");

function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 9, 8, hour + 4, minute);
}

function event(
  title: string,
  startHour: number,
  endHour: number,
  participantIds: string[] = [],
): CalEvent {
  return {
    id: title,
    title,
    allDay: false,
    startMs: at(startHour),
    endMs: at(endHour),
    participantIds,
    expectedVersion: "v1",
  };
}

const events: CalEvent[] = [
  event("Dentist", 9, 10, ["dad"]),
  event("Art club", 16, 17, ["ellie"]),
  event("Soccer practice", 17, 18, ["dad", "ellie"]),
  event("Family dinner", 19, 20),
  {
    ...event("Picture Day", 0, 24, ["ellie"]),
    allDay: true,
  },
];

function occurrence(
  title: string,
  assignee: string,
  state: "pending" | "done" = "pending",
): Occurrence {
  const fields = {
    task: `task-${title}` as Occurrence["task"],
    window: "2026-10-08" as Occurrence["window"],
    title,
    type: "chore" as const,
    lineage: `lineage-${title}` as Occurrence["lineage"],
    time: null,
    assignee,
  };
  return state === "done"
    ? {
        ...fields,
        state,
        by: assignee,
        at: "2026-10-08T12:00:00Z" as TasksViewRead["generatedAt"],
      }
    : { ...fields, state };
}

function tasksView(): TasksViewRead {
  return {
    occurrences: [
      occurrence("Take out trash", "dad"),
      occurrence("Feed Biscuit", "ellie"),
      occurrence("Make bed", "ellie", "done"),
    ],
    progress: [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 1, total: 2 },
    ],
    starBalances: [],
    definitions: [],
    bountyDefinitions: [],
    availableBounties: [],
    bountyClaims: [],
    today: "2026-10-08" as TasksViewRead["today"],
    generatedAt: "2026-10-08T19:10:00Z" as TasksViewRead["generatedAt"],
  };
}

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

type Call = { method: string; url: string; body: unknown };

/** An in-memory server: completing a Task changes what the next read returns. */
function installServer(overrides: Partial<PublicSettings> = {}) {
  const view = tasksView();
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url, body });
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json({ ...settings, ...overrides });
      }
      if (method === "GET" && url.includes("/api/events?")) {
        return json({ events, stale: false });
      }
      if (method === "GET" && url.endsWith("/api/tasks")) {
        return json(view);
      }
      if (method === "POST" && url.endsWith("/api/tasks/events")) {
        const done = body.events[0];
        view.occurrences = view.occurrences.map((row) =>
          row.task === done.task
            ? { ...row, state: "done", by: done.by, at: done.at }
            : row,
        );
        view.progress = view.progress.map((row) =>
          row.member === done.by ? { ...row, done: row.done + 1 } : row,
        );
        return json({ receipts: [] });
      }
      return json({ error: `unhandled ${method} ${url}` }, 500);
    }),
  );
  return calls;
}

async function renderToday(overrides: Partial<PublicSettings> = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const calls = installServer(overrides);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<TodayScreen />);
  await screen.findByRole("button", { name: "Ellie’s day" });
  await screen.findByRole("button", { name: /Dentist/ });
  return { calls, user };
}

const lane = (name: string) => screen.getByRole("group", { name });

describe("Today for everyone", () => {
  test("reads the Household civil day", async () => {
    const { calls } = await renderToday();
    const read = calls.find((call) => call.url.includes("/api/events?"));
    const query = new URL(read?.url ?? "", "http://localhost").searchParams;
    expect(query.get("from")).toBe("2026-10-08T04:00:00.000Z");
    expect(query.get("to")).toBe("2026-10-09T04:00:00.000Z");
  });

  test("gives each Active Member a lane of their own events", async () => {
    await renderToday();
    const dad = within(lane("Dad events"));
    const ellie = within(lane("Ellie events"));
    expect(dad.getByRole("button", { name: /Dentist/ })).toBeInTheDocument();
    expect(dad.queryByRole("button", { name: /Art club/ })).toBeNull();
    expect(ellie.getByRole("button", { name: /Art club/ })).toBeInTheDocument();
    expect(
      dad.getByRole("button", { name: /Soccer practice/ }),
    ).toBeInTheDocument();
    expect(
      ellie.getByRole("button", { name: /Soccer practice/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Former events" })).toBeNull();
  });

  test("draws an event for everyone once, across the lanes", async () => {
    await renderToday();
    expect(
      within(lane("Everyone events")).getByRole("button", {
        name: /Family dinner/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Family dinner/ }),
    ).toHaveLength(1);
  });

  test("dims events that have ended", async () => {
    await renderToday();
    expect(screen.getByRole("button", { name: /Dentist/ })).toHaveStyle({
      opacity: "0.55",
    });
    expect(screen.getByRole("button", { name: /Art club/ })).toHaveStyle({
      opacity: "1",
    });
  });

  test("shows each member's task progress and no task list", async () => {
    await renderToday();
    expect(
      within(screen.getByRole("button", { name: "Ellie’s day" })).getByText(
        "1/2",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("Today for one member", () => {
  test("shows their events, events for everyone, and their tasks", async () => {
    const { user } = await renderToday();
    await user.click(screen.getByRole("button", { name: "Ellie’s day" }));

    const ellie = within(lane("Ellie events"));
    expect(ellie.getByRole("button", { name: /Art club/ })).toBeInTheDocument();
    expect(
      ellie.getByRole("button", { name: /Family dinner/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dentist/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Picture Day/ })).toBeVisible();

    const tasks = within(screen.getByRole("region", { name: "Ellie tasks" }));
    expect(
      tasks.getByRole("checkbox", { name: "Feed Biscuit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Take out trash" }),
    ).toBeNull();
  });

  test("returns to everyone from the header or the same lane head", async () => {
    const { user } = await renderToday();
    await user.click(screen.getByRole("button", { name: "Ellie’s day" }));
    await user.click(screen.getByRole("button", { name: "Everyone" }));
    expect(screen.getByRole("button", { name: /Dentist/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ellie’s day" }));
    await user.click(screen.getByRole("button", { name: "Ellie’s day" }));
    expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
  });

  test("checks a task off", async () => {
    const { calls, user } = await renderToday();
    await user.click(screen.getByRole("button", { name: "Ellie’s day" }));
    await user.click(screen.getByRole("checkbox", { name: "Feed Biscuit" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("button", { name: "Ellie’s day" })).getByText(
          "2/2",
        ),
      ).toBeInTheDocument(),
    );
    const completed = calls.find((call) =>
      call.url.endsWith("/api/tasks/events"),
    );
    expect(completed?.body).toMatchObject({
      events: [{ kind: "completed", task: "task-Feed Biscuit", by: "ellie" }],
    });
  });
});

describe("Today editing", () => {
  test("tapping an event opens it for editing", async () => {
    const { user } = await renderToday();
    await user.click(screen.getByRole("button", { name: /Art club/ }));
    expect(await screen.findByDisplayValue("Art club")).toBeInTheDocument();
  });

  test("tapping a lane starts an event for that member", async () => {
    const { user } = await renderToday();
    await user.click(
      screen.getByRole("button", { name: "Add event for Ellie" }),
    );
    const who = within(await screen.findByRole("group", { name: "Who" }));
    expect(
      who.getByRole("button", { name: /Ellie/, pressed: true }),
    ).toBeInTheDocument();
    expect(
      who.getByRole("button", { name: /Dad/, pressed: false }),
    ).toBeInTheDocument();
  });

  test("Add task starts a task for the member in view", async () => {
    const { user } = await renderToday();
    await user.click(screen.getByRole("button", { name: "Ellie’s day" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    expect(
      within(dialog).getByRole("button", { name: "Ellie", pressed: true }),
    ).toBeInTheDocument();
  });

  test("without a Household Calendar, events are read-only and tasks still work", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    installServer({ calendarId: null });
    render(<TodayScreen />);
    await screen.findByRole("button", { name: "Ellie’s day" });
    expect(
      screen.getByText("Pick a family calendar under Settings."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add event" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add task" }),
    ).toBeInTheDocument();
  });
});
