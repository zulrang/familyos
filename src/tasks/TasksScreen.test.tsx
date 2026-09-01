// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PublicSettings } from "@/settings/types";
import {
  claimOccurrence,
  markDone,
  skipOccurrence,
  TasksScreen,
} from "./TasksScreen";
import type { Occurrence, TaskDefinition, TasksViewRead } from "./types";

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
    starBalances: [],
    definitions: [],
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
          recurrence: TaskDefinition["recurrence"];
          assignment: TaskDefinition["assignment"];
          time?: string;
          stars: number;
        };
        const assignee =
          body.assignment.kind === "fixed"
            ? body.assignment.member
            : body.assignment.kind === "rotation"
              ? (body.assignment.order[0] ?? null)
              : null;
        const occ: Occurrence = {
          state: "pending",
          task: `task-${store.occurrences.length + 1}` as Occurrence["task"],
          window: store.today,
          title: body.title,
          type: body.type,
          lineage:
            `lin-${store.occurrences.length + 1}` as Occurrence["lineage"],
          time: (body.time ?? null) as Occurrence["time"],
          assignee,
        };
        store.occurrences = [...store.occurrences, occ].sort((a, b) => {
          if (a.time && b.time)
            return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
          if (a.time) return -1;
          if (b.time) return 1;
          return 0;
        });
        if (assignee) {
          store.progress = store.progress.map((row) =>
            row.member === assignee ? { ...row, total: row.total + 1 } : row,
          );
        }
        store.definitions = [
          ...store.definitions,
          {
            id: occ.task,
            lineage: occ.lineage,
            title: body.title,
            type: body.type,
            recurrence: body.recurrence,
            assignment: body.assignment,
            time: occ.time,
            stars: body.stars,
            retiredAt: null,
          },
        ];
        return json({ definition: { id: occ.task } });
      }
      if (
        method === "PUT" &&
        url.endsWith("/api/tasks") &&
        !url.includes("/events")
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          id: string;
          title: string;
          type: "chore" | "routine";
          recurrence: TaskDefinition["recurrence"];
          assignment: TaskDefinition["assignment"];
          time?: string;
          stars: number;
        };
        const current = store.definitions.find((row) => row.id === body.id);
        if (!current) return json({ error: "task not found" }, 404);
        const scheduleChanged =
          JSON.stringify(current.recurrence) !==
            JSON.stringify(body.recurrence) ||
          JSON.stringify(current.assignment) !==
            JSON.stringify(body.assignment);
        const time = (body.time ?? null) as Occurrence["time"];
        const assignee =
          body.assignment.kind === "fixed"
            ? body.assignment.member
            : body.assignment.kind === "rotation"
              ? (body.assignment.order[0] ?? null)
              : null;
        if (!scheduleChanged) {
          store.definitions = store.definitions.map((row) =>
            row.id === body.id
              ? {
                  ...row,
                  title: body.title,
                  type: body.type,
                  time,
                  stars: body.stars,
                }
              : row,
          );
          store.occurrences = store.occurrences.map((row) =>
            row.task === body.id
              ? { ...row, title: body.title, type: body.type, time }
              : row,
          );
          return json({
            definition: store.definitions.find((row) => row.id === body.id),
          });
        }
        const replacement: TaskDefinition = {
          id: `task-${store.definitions.length + 1}` as TaskDefinition["id"],
          lineage: current.lineage,
          title: body.title,
          type: body.type,
          recurrence: body.recurrence,
          assignment: body.assignment,
          time,
          stars: body.stars,
          retiredAt: null,
        };
        store.definitions = [
          ...store.definitions.filter((row) => row.id !== body.id),
          replacement,
        ];
        store.occurrences = store.occurrences.map((row) => {
          if (row.task !== body.id) return row;
          const prior = row.assignee;
          if (prior && prior !== assignee) {
            store.progress = store.progress.map((progress) => {
              if (progress.member === prior) {
                return { ...progress, total: progress.total - 1 };
              }
              if (assignee && progress.member === assignee) {
                return { ...progress, total: progress.total + 1 };
              }
              return progress;
            });
          }
          return {
            ...row,
            task: replacement.id,
            title: body.title,
            type: body.type,
            time,
            assignee,
          };
        });
        return json({ definition: replacement });
      }
      if (method === "POST" && url.endsWith("/api/tasks/events")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          events: {
            kind: "claimed" | "completed" | "skipped";
            task: string;
            window: string;
            by?: string;
            reason?: string | null;
          }[];
        };
        const event = body.events[0];
        const current = store.occurrences.find(
          (row) => row.task === event?.task && row.window === event.window,
        );
        const already =
          event?.kind === "claimed"
            ? current?.state === "claimed"
            : event?.kind === "skipped"
              ? current?.state === "skipped"
              : current?.state === "done";
        if (event?.kind === "claimed" && current && !already) {
          const next = claimOccurrence(store, current, event.by ?? "");
          store.occurrences = next.occurrences;
          store.progress = next.progress;
        }
        if (event?.kind === "completed" && current && !already) {
          const next = markDone(store, current, event.by);
          store.occurrences = next.occurrences;
          store.progress = next.progress;
        }
        if (event?.kind === "skipped" && current && !already) {
          const next = skipOccurrence(store, current, event.reason ?? null);
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

  test("the editor submits a nonnegative integer star value", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Feed cat");
    const stars = screen.getByRole("spinbutton", { name: "Stars" });
    await user.clear(stars);
    await user.type(stars, "6");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await screen.findByText("Feed cat");
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        urlOf(input) === "/api/tasks" &&
        (init?.method ?? "GET").toUpperCase() === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      stars: 6,
    });
  });

  test("the editor cannot submit an unsafe integer star value", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(emptyView());
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Feed cat");
    await user.click(screen.getByRole("button", { name: "Ellie" }));
    const stars = screen.getByRole("spinbutton", { name: "Stars" });
    await user.clear(stars);
    await user.type(stars, String(Number.MAX_SAFE_INTEGER + 1));

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.find(
        ([input, init]) =>
          urlOf(input) === "/api/tasks" &&
          (init?.method ?? "GET").toUpperCase() === "POST",
      ),
    ).toBeUndefined();
  });

  test("balances and star values do not render in task columns", async () => {
    const store = emptyView();
    store.starBalances = [{ member: "dad", balance: 99 }];
    installFetch(store);
    render(<TasksScreen />);

    await screen.findByRole("heading", { name: "Dad" });
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.queryByText(/star|point|balance/i)).not.toBeInTheDocument();
  });

  test("the editor submits recurrence, rotation order, and stars together", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Dishes rotation");
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Mon" }));
    await user.click(screen.getByRole("button", { name: "Rotation" }));
    await user.click(screen.getByRole("button", { name: "Ellie" }));
    const stars = screen.getByRole("spinbutton", { name: "Stars" });
    await user.clear(stars);
    await user.type(stars, "4");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Dishes rotation")).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        urlOf(input).endsWith("/api/tasks") &&
        init?.method === "POST" &&
        !urlOf(input).endsWith("/events")
      );
    });
    expect(JSON.parse(String(createCall?.[1]?.body ?? "{}"))).toMatchObject({
      recurrence: { kind: "weekly", days: ["mon"] },
      stars: 4,
      assignment: {
        kind: "rotation",
        order: ["dad", "ellie"],
      },
    });
  });

  test("the Household column appears only for an unclaimed open occurrence", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await screen.findByRole("button", { name: "Add task" });
    expect(
      screen.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add task" }));
    await user.type(screen.getByPlaceholderText("Title"), "Open dishes");
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Mon" }));
    await user.click(screen.getByRole("button", { name: "Household" }));
    const stars = screen.getByRole("spinbutton", { name: "Stars" });
    await user.clear(stars);
    await user.type(stars, "5");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const household = await screen.findByRole("heading", {
      name: "Household",
    });
    expect(household.closest("section")).toHaveTextContent("Open dishes");
    expect(household.closest("section")).toHaveTextContent("0/1");
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        urlOf(input).endsWith("/api/tasks") &&
        init?.method === "POST" &&
        !urlOf(input).endsWith("/events"),
    );
    expect(JSON.parse(String(createCall?.[1]?.body ?? "{}"))).toMatchObject({
      recurrence: { kind: "weekly", days: ["mon"] },
      assignment: { kind: "open" },
      stars: 5,
    });
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

  test("completing a task greys it out and moves it below remaining work", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "t-early" as Occurrence["task"],
        window: store.today,
        title: "Brush teeth",
        type: "routine",
        lineage: "lin-1" as Occurrence["lineage"],
        time: "07:00" as Occurrence["time"],
        assignee: "dad",
      },
      {
        state: "pending",
        task: "t-late" as Occurrence["task"],
        window: store.today,
        title: "Walk dog",
        type: "chore",
        lineage: "lin-2" as Occurrence["lineage"],
        time: null,
        assignee: "dad",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 2 },
      { member: "ellie", done: 0, total: 0 },
    ];
    installFetch(store);
    render(<TasksScreen />);

    const dad = (await screen.findByRole("heading", { name: "Dad" })).closest(
      "section",
    );
    expect(dad).not.toBeNull();
    expect(
      within(dad as HTMLElement)
        .getAllByRole("checkbox")
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Brush teeth", "Walk dog"]);

    await user.click(screen.getByRole("checkbox", { name: "Brush teeth" }));
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "Brush teeth" }),
      ).toBeChecked();
    });

    const after = within(dad as HTMLElement).getAllByRole("checkbox");
    expect(after.map((el) => el.getAttribute("aria-label"))).toEqual([
      "Walk dog",
      "Brush teeth",
    ]);
    expect(after[0]?.closest("div")).toHaveStyle({ opacity: "1" });
    expect(after[1]?.closest("div")).toHaveStyle({
      opacity: "0.25",
      background: "#b6d3d3",
    });
  });

  test("completing a later task lands it after already-done morning rows", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "t-dinner" as Occurrence["task"],
        window: store.today,
        title: "Dinner",
        type: "chore",
        lineage: "lin-dinner" as Occurrence["lineage"],
        time: "18:00" as Occurrence["time"],
        assignee: "dad",
      },
      {
        state: "pending",
        task: "t-walk" as Occurrence["task"],
        window: store.today,
        title: "Walk dog",
        type: "chore",
        lineage: "lin-walk" as Occurrence["lineage"],
        time: null,
        assignee: "dad",
      },
      {
        state: "done",
        task: "t-brush" as Occurrence["task"],
        window: store.today,
        title: "Brush teeth",
        type: "routine",
        lineage: "lin-brush" as Occurrence["lineage"],
        time: "07:00" as Occurrence["time"],
        assignee: "dad",
        by: "dad",
        at: store.generatedAt,
      },
    ];
    store.progress = [
      { member: "dad", done: 1, total: 3 },
      { member: "ellie", done: 0, total: 0 },
    ];
    installFetch(store);
    render(<TasksScreen />);

    const dad = (await screen.findByRole("heading", { name: "Dad" })).closest(
      "section",
    );
    expect(dad).not.toBeNull();
    expect(
      within(dad as HTMLElement)
        .getAllByRole("checkbox")
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Dinner", "Walk dog", "Brush teeth"]);

    await user.click(screen.getByRole("checkbox", { name: "Dinner" }));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Dinner" })).toBeChecked();
    });

    expect(
      within(dad as HTMLElement)
        .getAllByRole("checkbox")
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Walk dog", "Brush teeth", "Dinner"]);
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

  test("one tap attributes a rotation completion and keeps the done row with its completer", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "rotation" as Occurrence["task"],
        window: store.today,
        title: "Kitchen",
        type: "chore",
        lineage: "rotation-lineage" as Occurrence["lineage"],
        time: null,
        assignee: "ellie",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 0, total: 1 },
    ];
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("checkbox", { name: "Kitchen" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Kitchen" })).toBeChecked();
    });
    const ellieColumn = screen
      .getByRole("heading", { name: "Ellie" })
      .closest("section");
    expect(ellieColumn).toHaveTextContent("Kitchen");
    expect(ellieColumn).toHaveTextContent("1/1");
    expect(
      screen.queryByRole("button", { name: "Dad" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ellie" }),
    ).not.toBeInTheDocument();
    const eventCall = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith("/api/tasks/events"),
    );
    const event = JSON.parse(String(eventCall?.[1]?.body ?? "{}")).events[0];
    expect(event.by).toBe("ellie");
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

  test("an explicit completer replaces a concurrent claimant in optimistic progress", () => {
    const store = emptyView();
    const staleOccurrence: Occurrence = {
      state: "pending",
      task: "open-race" as Occurrence["task"],
      window: store.today,
      title: "Feed cat",
      type: "chore",
      lineage: "lin-open-race" as Occurrence["lineage"],
      time: null,
      assignee: null,
    };
    store.occurrences = [
      {
        ...staleOccurrence,
        state: "claimed",
        assignee: "dad",
        by: "dad",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 0, total: 0 },
    ];

    const completed = markDone(store, staleOccurrence, "ellie");

    expect(completed.occurrences[0]).toMatchObject({
      state: "done",
      assignee: "ellie",
      by: "ellie",
    });
    expect(completed.progress).toEqual([
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 1, total: 1 },
    ]);
  });

  test("skipping a claimed open occurrence unassigns it and drops the claimant's total", () => {
    const store = emptyView();
    const occurrence: Occurrence = {
      state: "claimed",
      task: "open-skip" as Occurrence["task"],
      window: store.today,
      title: "Walk dog",
      type: "chore",
      lineage: "lin-open-skip" as Occurrence["lineage"],
      time: null,
      assignee: "dad",
      by: "dad",
    };
    store.occurrences = [occurrence];
    store.progress = [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 0, total: 0 },
    ];

    const skipped = skipOccurrence(store, occurrence, null);

    expect(skipped.occurrences[0]).toMatchObject({
      state: "skipped",
      assignee: null,
      reason: null,
    });
    expect(skipped.progress).toEqual([
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 0, total: 0 },
    ]);
  });

  test("skipping a pending assigned occurrence keeps its assignee and total", () => {
    const store = emptyView();
    const occurrence: Occurrence = {
      state: "pending",
      task: "fixed-skip" as Occurrence["task"],
      window: store.today,
      title: "Dishes",
      type: "chore",
      lineage: "lin-fixed-skip" as Occurrence["lineage"],
      time: null,
      assignee: "ellie",
    };
    store.occurrences = [occurrence];
    store.progress = [
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 0, total: 1 },
    ];

    const skipped = skipOccurrence(store, occurrence, "Away");

    expect(skipped.occurrences[0]).toMatchObject({
      state: "skipped",
      assignee: "ellie",
      reason: "Away",
    });
    expect(skipped.progress).toEqual([
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 0, total: 1 },
    ]);
  });

  test("skipping with no reason shows the skipped row", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "skip-none" as Occurrence["task"],
        window: store.today,
        title: "Walk dog",
        type: "chore",
        lineage: "lin-skip-none" as Occurrence["lineage"],
        time: null,
        assignee: "dad",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 0, total: 0 },
    ];
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Skip Walk dog" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Skip task" });
    await user.click(within(dialog).getByRole("button", { name: "Skip" }));

    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Walk dog" }),
    ).not.toBeChecked();
    expect(dialog).not.toBeInTheDocument();
    const skipRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"kind":"skipped"'),
    );
    expect(JSON.parse(String(skipRequest?.[1]?.body)).events[0]).toMatchObject({
      kind: "skipped",
      task: "skip-none",
      reason: null,
    });
  });

  test("skipping with a preset reason shows that reason", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "skip-away" as Occurrence["task"],
        window: store.today,
        title: "Dishes",
        type: "chore",
        lineage: "lin-skip-away" as Occurrence["lineage"],
        time: null,
        assignee: "ellie",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 0 },
      { member: "ellie", done: 0, total: 1 },
    ];
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Skip Dishes" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Skip task" });
    expect(within(dialog).getByRole("button", { name: "Away" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Sick" })).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Not needed" }),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Away" }));

    expect(await screen.findByText("Away")).toBeInTheDocument();
    expect(screen.queryByText("Skipped")).not.toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
    const skipRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"kind":"skipped"'),
    );
    expect(JSON.parse(String(skipRequest?.[1]?.body)).events[0]).toMatchObject({
      kind: "skipped",
      reason: "Away",
    });
  });

  test("free text is stored when entered and never required", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "skip-note" as Occurrence["task"],
        window: store.today,
        title: "Trash",
        type: "chore",
        lineage: "lin-skip-note" as Occurrence["lineage"],
        time: null,
        assignee: "dad",
      },
    ];
    store.progress = [
      { member: "dad", done: 0, total: 1 },
      { member: "ellie", done: 0, total: 0 },
    ];
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Skip Trash" }));
    const dialog = screen.getByRole("dialog", { name: "Skip task" });
    const note = within(dialog).getByPlaceholderText("Reason (optional)");
    expect(note).not.toHaveAttribute("required");
    await user.type(note, "kid at grandma's");
    await user.click(within(dialog).getByRole("button", { name: "Skip" }));

    expect(await screen.findByText("kid at grandma's")).toBeInTheDocument();
    const skipRequest = fetchMock.mock.calls.find(([, init]) =>
      String(init?.body).includes('"kind":"skipped"'),
    );
    expect(JSON.parse(String(skipRequest?.[1]?.body)).events[0]).toMatchObject({
      kind: "skipped",
      reason: "kid at grandma's",
    });
  });

  function seedFixed(store: TasksViewRead, title: string, member: string) {
    const definition: TaskDefinition = {
      id: "edit-me" as TaskDefinition["id"],
      lineage: "lin-edit" as TaskDefinition["lineage"],
      title,
      type: "chore",
      recurrence: { kind: "daily" },
      assignment: { kind: "fixed", member },
      time: null,
      stars: 0,
      retiredAt: null,
    };
    store.definitions = [definition];
    store.occurrences = [
      {
        state: "pending",
        task: definition.id,
        window: store.today,
        title,
        type: "chore",
        lineage: definition.lineage,
        time: null,
        assignee: member,
      },
    ];
    store.progress = store.progress.map((row) =>
      row.member === member ? { ...row, total: row.total + 1 } : row,
    );
    return definition;
  }

  test("editing only the title overwrites the row without minting a new task", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const definition = seedFixed(store, "Dishes", "dad");
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Edit Dishes" }),
    );
    const title = screen.getByPlaceholderText("Title");
    await user.clear(title);
    await user.type(title, "Trash");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Trash")).toBeInTheDocument();
    expect(screen.queryByText("Dishes")).not.toBeInTheDocument();
    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        urlOf(input).endsWith("/api/tasks") &&
        (init?.method ?? "GET").toUpperCase() === "PUT",
    );
    expect(JSON.parse(String(saveCall?.[1]?.body ?? "{}"))).toMatchObject({
      id: definition.id,
      title: "Trash",
      recurrence: { kind: "daily" },
      assignment: { kind: "fixed", member: "dad" },
    });
  });

  test("editing assignment retires the old task and shows the new title on the new assignee", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const definition = seedFixed(store, "Dishes", "dad");
    const fetchMock = installFetch(store);
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "Edit Dishes" }),
    );
    const title = screen.getByPlaceholderText("Title");
    await user.clear(title);
    await user.type(title, "Kitchen");
    await user.click(screen.getByRole("button", { name: "Ellie" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Kitchen")).toBeInTheDocument();
    const ellie = screen
      .getByRole("heading", { name: "Ellie" })
      .closest("section");
    expect(ellie).toHaveTextContent("Kitchen");
    const dad = screen.getByRole("heading", { name: "Dad" }).closest("section");
    expect(dad).not.toHaveTextContent("Kitchen");
    const saveCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        urlOf(input).endsWith("/api/tasks") &&
        (init?.method ?? "GET").toUpperCase() === "PUT",
    );
    expect(JSON.parse(String(saveCall?.[1]?.body ?? "{}"))).toMatchObject({
      id: definition.id,
      title: "Kitchen",
      assignment: { kind: "fixed", member: "ellie" },
    });
  });
});
