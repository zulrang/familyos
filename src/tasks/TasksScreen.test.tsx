// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PublicSettings } from "@/settings/types";
import { claimOccurrence, markDone, TasksScreen } from "./TasksScreen";
import type { Occurrence, TasksViewRead } from "./types";

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
    { id: "former", name: "Former", status: "retired" },
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
          member: string | null;
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
        if (body.member) {
          store.progress = store.progress.map((row) =>
            row.member === body.member ? { ...row, total: row.total + 1 } : row,
          );
        }
        return json({ definition: { id: occ.task } });
      }
      if (method === "POST" && url.endsWith("/api/tasks/events")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          events: {
            kind: "claimed" | "completed";
            task: string;
            window: string;
            by: string;
          }[];
        };
        const event = body.events[0];
        const current = store.occurrences.find(
          (row) => row.task === event?.task && row.window === event.window,
        );
        const already =
          event?.kind === "claimed"
            ? current?.state === "claimed"
            : current?.state === "done";
        if (event?.kind === "claimed" && current && !already) {
          const next = claimOccurrence(store, current, event.by);
          store.occurrences = next.occurrences;
          store.progress = next.progress;
        }
        if (event?.kind === "completed" && current && !already) {
          const next = markDone(store, current, event.by);
          store.occurrences = next.occurrences;
          store.progress = next.progress;
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

describe("TasksScreen", () => {
  test("creating a task shows it in the assignee column the same day", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    installFetch(store);
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
  });

  test("the Household column appears only for an unclaimed open occurrence", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    installFetch(store);
    render(<TasksScreen />);

    await screen.findByRole("button", { name: "Add task" });
    expect(
      screen.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Open dishes");
    await user.click(screen.getByRole("button", { name: "Household" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    const household = await screen.findByRole("heading", {
      name: "Household",
    });
    expect(household.closest("section")).toHaveTextContent("Open dishes");
    expect(household.closest("section")).toHaveTextContent("0/1");
  });

  test("claiming moves an open occurrence and its count to the chosen member", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "open-claim" as Occurrence["task"],
        window: store.today,
        title: "Open dishes",
        type: "chore",
        lineage: "lin-open-claim" as Occurrence["lineage"],
        time: null,
        assignee: null,
      },
    ];
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Claim Open dishes" }),
    );
    const picker = screen.getByRole("dialog", { name: "Claim task" });
    expect(
      screen.queryByRole("button", { name: "Former" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dad" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Household" }),
      ).not.toBeInTheDocument();
    });
    const dad = screen.getByRole("heading", { name: "Dad" }).closest("section");
    expect(dad).toHaveTextContent("Open dishes");
    expect(dad).toHaveTextContent("0/1");
    expect(picker).not.toBeInTheDocument();
    const claimRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"kind":"claimed"'),
    );
    expect(String(claimRequest?.[1]?.body)).toContain('"by":"dad"');
  });

  test("completing an unclaimed open occurrence requires a member pick", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "open-complete" as Occurrence["task"],
        window: store.today,
        title: "Feed cat",
        type: "chore",
        lineage: "lin-open-complete" as Occurrence["lineage"],
        time: null,
        assignee: null,
      },
    ];
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("checkbox", { name: "Feed cat" }));
    expect(
      screen.getByRole("dialog", { name: "Complete task" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ellie" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Feed cat" })).toBeChecked();
    });
    const ellie = screen
      .getByRole("heading", { name: "Ellie" })
      .closest("section");
    expect(ellie).toHaveTextContent("Feed cat");
    expect(ellie).toHaveTextContent("1/1");
    const completionRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"kind":"completed"'),
    );
    expect(String(completionRequest?.[1]?.body)).toContain('"by":"ellie"');
  });

  test("completing a claimed occurrence uses the claimant without a picker", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "claimed",
        task: "claimed-complete" as Occurrence["task"],
        window: store.today,
        title: "Take bins out",
        type: "chore",
        lineage: "lin-claimed-complete" as Occurrence["lineage"],
        time: null,
        assignee: "dad",
        by: "dad",
      },
    ];
    store.progress[0] = { member: "dad", done: 0, total: 1 };
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("checkbox", { name: "Take bins out" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "Take bins out" }),
      ).toBeChecked();
    });
    const dad = screen.getByRole("heading", { name: "Dad" }).closest("section");
    expect(dad).toHaveTextContent("1/1");
    const completionRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"kind":"completed"'),
    );
    expect(String(completionRequest?.[1]?.body)).toContain('"by":"dad"');
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
