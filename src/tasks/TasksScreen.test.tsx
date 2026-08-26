// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PublicSettings } from "@/settings/types";
import { markDone, TasksScreen } from "./TasksScreen";
import type { Instant, Occurrence, TasksViewRead } from "./types";

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
    { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
  ],
  calendarId: null,
  listIds: [],
  timeZone: "America/New_York",
  signedIn: true,
  googleConfigured: true,
  uiScale: 1,
  idleDimAfterMs: 300_000,
  idleDimTo: 10,
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

function emptyView(): TasksViewRead {
  return {
    occurrences: [],
    progress: [
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 0, total: 0 },
    ],
    today: "2026-08-25" as TasksViewRead["today"],
    generatedAt: "2026-08-25T16:00:00Z" as TasksViewRead["generatedAt"],
  };
}

function installFetch(store: TasksViewRead) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/tasks")) {
        return json(store);
      }
      if (
        method === "POST" &&
        url.endsWith("/api/tasks") &&
        !url.includes("/events")
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          title: string;
          type: "chore" | "routine";
          recurrence: unknown;
          member: string;
          time?: string;
        };
        const occ: Occurrence = {
          state: "pending",
          task: `task-${store.occurrences.length + 1}` as Occurrence["task"],
          window: store.today,
          title: body.title,
          type: body.type,
          lineage:
            `lin-${store.occurrences.length + 1}` as Occurrence["lineage"],
          time: (body.time ?? null) as Occurrence["time"],
          assignee: body.member,
        };
        store.occurrences = [...store.occurrences, occ].sort((a, b) => {
          if (a.time && b.time)
            return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
          if (a.time) return -1;
          if (b.time) return 1;
          return 0;
        });
        store.progress = store.progress.map((row) =>
          row.member === body.member ? { ...row, total: row.total + 1 } : row,
        );
        return json({ definition: { id: occ.task } });
      }
      if (method === "POST" && url.endsWith("/api/tasks/events")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          events: { task: string; window: string }[];
        };
        const event = body.events[0];
        const already = store.occurrences.find(
          (row) =>
            row.task === event?.task &&
            row.window === event.window &&
            row.state === "done",
        );
        store.occurrences = store.occurrences.map((row) =>
          row.task === event?.task && row.window === event.window
            ? {
                ...row,
                state: "done",
                by: row.assignee ?? "dad",
                at: "2026-08-25T16:05:00Z" as Instant,
                assignee: row.assignee,
              }
            : row,
        );
        if (!already) {
          store.progress = store.progress.map((row) => {
            const occ = store.occurrences.find((o) => o.task === event?.task);
            return occ && row.member === occ.assignee
              ? { ...row, done: row.done + 1 }
              : row;
          });
        }
        return json({
          receipts: [{ status: already ? "already-present" : "inserted" }],
        });
      }
      return json({ error: "missing" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function submittedRecurrence(
  fetchMock: ReturnType<typeof installFetch>,
): unknown {
  const createCall = fetchMock.mock.calls.find(
    ([input, init]) =>
      urlOf(input).endsWith("/api/tasks") && (init?.method ?? "GET") === "POST",
  );
  const body = JSON.parse(String(createCall?.[1]?.body ?? "{}")) as {
    recurrence?: unknown;
  };
  return body.recurrence;
}

describe("TasksScreen", () => {
  test("creating a task shows it in the assignee column the same day", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Walk dog");
    await user.click(screen.getByRole("button", { name: "Ellie" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Walk dog")).toBeInTheDocument();
    const ellie = screen
      .getByRole("heading", { name: "Ellie" })
      .closest("section");
    expect(ellie).toHaveTextContent("Walk dog");
    expect(ellie).toHaveTextContent("0/1");
    expect(submittedRecurrence(fetchMock)).toEqual({ kind: "daily" });
  });

  test("the editor submits selected weekly days", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Bins");
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Mon" }));
    await user.click(screen.getByRole("button", { name: "Thu" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(submittedRecurrence(fetchMock)).toEqual({
      kind: "weekly",
      days: ["mon", "thu"],
    });
  });

  test("the editor requires and submits a date for a once task", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Change filter");
    await user.click(screen.getByRole("button", { name: "Once" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(screen.getByLabelText("Date"), "2026-09-01");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(submittedRecurrence(fetchMock)).toEqual({
      kind: "once",
      date: "2026-09-01",
    });
  });

  test("the editor limits monthly recurrence to days 1 through 28", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Water filter");
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    const day = screen.getByRole("spinbutton", { name: "Day of month" });
    await user.clear(day);
    await user.type(day, "29");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.clear(day);
    await user.type(day, "28");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(submittedRecurrence(fetchMock)).toEqual({
      kind: "monthly",
      day: 28,
    });
  });

  test("tapping the circle marks the row done and increments progress once", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "t1" as Occurrence["task"],
        window: store.today,
        title: "Dishes",
        type: "chore",
        lineage: "lin-1" as Occurrence["lineage"],
        time: null,
        assignee: "dad",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 0, total: 0 },
    ];
    installFetch(store);
    render(<TasksScreen />);

    const checkbox = await screen.findByRole("checkbox", { name: "Dishes" });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Dishes" })).toBeChecked();
    });
    const dad = screen.getByText("Dad").closest("section");
    expect(dad).toHaveTextContent("1/1");

    await user.click(screen.getByRole("checkbox", { name: "Dishes" }));
    await waitFor(() => {
      expect(screen.getByText("Dad").closest("section")).toHaveTextContent(
        "1/1",
      );
    });
    expect(screen.getByRole("checkbox", { name: "Dishes" })).toBeChecked();
  });

  test("reapplying a stale optimistic completion does not increment progress twice", () => {
    const store = emptyView();
    const occurrence: Occurrence = {
      state: "pending",
      task: "t1" as Occurrence["task"],
      window: store.today,
      title: "Dishes",
      type: "chore",
      lineage: "lin-1" as Occurrence["lineage"],
      time: null,
      assignee: "dad",
    };
    store.occurrences = [occurrence];
    store.progress = [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 0, total: 0 },
    ];

    const afterFirstTap = markDone(store, occurrence);
    const afterSecondTap = markDone(afterFirstTap, occurrence);

    expect(afterSecondTap.progress).toContainEqual({
      member: "dad",
      done: 1,
      total: 1,
    });
  });
});
