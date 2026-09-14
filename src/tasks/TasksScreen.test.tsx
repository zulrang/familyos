// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PublicSettings } from "@/settings/types";
import { TaskCelebration } from "./TaskCelebration";
import { markDone, skipOccurrence, TasksScreen } from "./TasksScreen";
import type {
  AvailableBounty,
  BountyDefinition,
  ClaimedBounty,
  LegacyTaskDefinition,
  Occurrence,
  TasksViewRead,
} from "./types";

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
    bountyDefinitions: [],
    availableBounties: [],
    bountyClaims: [],
    today: "2026-08-25" as TasksViewRead["today"],
    generatedAt: "2026-08-25T16:00:00Z" as TasksViewRead["generatedAt"],
  };
}

function installFetch(
  store: TasksViewRead,
  settingsResponse: PublicSettings = settings,
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settingsResponse);
      }
      if (method === "GET" && url.endsWith("/api/tasks")) {
        return json(store);
      }
      if (
        method === "POST" &&
        url.endsWith("/api/tasks") &&
        !url.includes("/events")
      ) {
        const rawBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        const body = rawBody as unknown as {
          title: string;
          type: "chore" | "routine";
          recurrence: LegacyTaskDefinition["recurrence"];
          assignment: LegacyTaskDefinition["assignment"];
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
          recurrence: LegacyTaskDefinition["recurrence"];
          assignment: LegacyTaskDefinition["assignment"];
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
        const replacement: LegacyTaskDefinition = {
          id: `task-${store.definitions.length + 1}` as LegacyTaskDefinition["id"],
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
            kind: "completed" | "skipped";
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
          event?.kind === "skipped"
            ? current?.state === "skipped"
            : current?.state === "done";
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

type ScriptedMutation = {
  method: "POST" | "PATCH";
  response: unknown;
  status?: number;
};

function installScriptedBountyFetch(
  taskReads: readonly TasksViewRead[],
  mutations: readonly ScriptedMutation[],
  settingsResponse: PublicSettings = settings,
) {
  let readIndex = 0;
  let mutationIndex = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settingsResponse);
      }
      if (method === "GET" && url.endsWith("/api/tasks")) {
        const response = taskReads[Math.min(readIndex, taskReads.length - 1)];
        readIndex += 1;
        if (!response) throw new Error("Missing scripted Tasks read response");
        return json(response);
      }
      if (
        url.endsWith("/api/tasks") &&
        (method === "POST" || method === "PATCH")
      ) {
        const mutation = mutations[mutationIndex];
        mutationIndex += 1;
        if (!mutation || mutation.method !== method) {
          throw new Error(`Unexpected ${method} Bounty request`);
        }
        return json(mutation.response, mutation.status);
      }
      throw new Error(`Unexpected ${method} ${url}`);
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
  test("Bounties focus advertises, claims, and completes zero-Star work without shared creation", async () => {
    const user = userEvent.setup();
    const initial = emptyView();
    const definition = {
      kind: "bounty",
      id: "bounty-zero",
      lineage: "bounty-lineage",
      type: "chore",
      title: "Wipe table",
      stars: 0,
      recurrence: { kind: "once" },
      revision: 0,
      retiredAt: null,
    } as unknown as BountyDefinition;
    const available = {
      kind: "available",
      id: "offering-zero",
      offering: { kind: "once", definition: definition.id },
      title: definition.title,
      stars: definition.stars,
      definitionRevision: definition.revision,
    } as AvailableBounty;
    initial.bountyDefinitions = [definition];
    initial.availableBounties = [available];
    const claimed = {
      kind: "claimed-bounty",
      claim: {
        id: "claim-zero",
        offering: available.offering,
        member: "dad",
        scheduledOn: initial.today,
        title: available.title,
        stars: available.stars,
      },
      revision: 0,
      state: { kind: "unfinished" },
    } as ClaimedBounty;
    const afterClaim: TasksViewRead = {
      ...initial,
      availableBounties: [],
      bountyClaims: [claimed],
      progress: initial.progress.map((row) =>
        row.member === "dad" ? { ...row, total: 1 } : row,
      ),
    };
    const afterComplete: TasksViewRead = {
      ...afterClaim,
      bountyClaims: [
        {
          ...claimed,
          state: {
            kind: "completed",
            completion: {
              id: "completion-zero",
              claim: claimed.claim.id,
              by: "dad",
              at: initial.generatedAt,
              creditedStars: claimed.claim.stars,
            },
          },
        } as ClaimedBounty,
      ],
      progress: afterClaim.progress.map((row) =>
        row.member === "dad" ? { ...row, done: 1 } : row,
      ),
    };
    const fetchMock = installScriptedBountyFetch(
      [initial, afterClaim, afterComplete],
      [
        { method: "PATCH", response: { status: "accepted" } },
        { method: "PATCH", response: { status: "accepted" } },
      ],
    );
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Bounties" }));
    expect(screen.getByText("Wipe table")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("Stars on completion")).toBeVisible();
    expect(screen.queryByText("Manage Bounties")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add Bounty" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Claim Wipe table" }));
    await user.click(screen.getByRole("button", { name: "Dad" }));
    await user.click(screen.getByRole("button", { name: "Family Board" }));
    await user.click(
      screen.getByRole("button", { name: "View tasks for Dad" }),
    );
    expect(screen.getByText("Wipe table")).toBeVisible();
    expect(screen.getByText("0 Stars")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Skip Wipe table" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Wipe table" }));
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Bounties" }));
    expect(screen.queryByText("Wipe table")).not.toBeInTheDocument();
  });

  test("Bounties focus has an empty state before the first offering", async () => {
    const user = userEvent.setup();
    installFetch(emptyView());
    render(<TasksScreen />);
    await user.click(await screen.findByRole("button", { name: "Bounties" }));
    expect(screen.getByText("No Bounties available")).toBeVisible();
  });

  test("orders offerings by descending Stars with stable ties and keeps zero-Star work", async () => {
    const store = emptyView();
    store.availableBounties = [
      ["One Star", 1],
      ["First five", 5],
      ["Zero Stars", 0],
      ["Second five", 5],
    ].map(
      ([title, stars], index) =>
        ({
          kind: "available",
          id: `sorted-offering-${index}`,
          offering: {
            kind: "once",
            definition: `sorted-definition-${index}`,
          },
          title,
          stars,
          definitionRevision: 0,
        }) as AvailableBounty,
    );
    installFetch(store);
    render(<TasksScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Bounties" }),
    );

    expect(
      screen
        .getAllByRole("button", { name: /^Claim / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Claim First five",
      "Claim Second five",
      "Claim One Star",
      "Claim Zero Stars",
    ]);
    expect(screen.getByText("Star on completion")).toBeVisible();
    expect(screen.getAllByText("Stars on completion")).toHaveLength(3);
  });

  test("a member releases a Bounty and another member can claim the same offering", async () => {
    const webCrypto = crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: webCrypto.getRandomValues.bind(webCrypto),
    });
    const user = userEvent.setup();
    const initial = emptyView();
    const definition = {
      kind: "bounty",
      id: "bounty-release",
      lineage: "bounty-release-lineage",
      type: "chore",
      title: "Sweep steps",
      stars: 5,
      recurrence: { kind: "once" },
      revision: 0,
      retiredAt: null,
    } as BountyDefinition;
    const offering = {
      kind: "available",
      id: "offering-release",
      offering: { kind: "once", definition: definition.id },
      title: definition.title,
      stars: definition.stars,
      definitionRevision: definition.revision,
    } as AvailableBounty;
    const firstClaim = {
      kind: "claimed-bounty",
      claim: {
        id: "claim-release-first",
        offering: offering.offering,
        member: "dad",
        scheduledOn: initial.today,
        title: offering.title,
        stars: offering.stars,
      },
      revision: 0,
      state: { kind: "unfinished" },
    } as ClaimedBounty;
    initial.bountyDefinitions = [definition];
    initial.bountyClaims = [firstClaim];
    initial.progress = initial.progress.map((row) =>
      row.member === "dad" ? { ...row, total: 1 } : row,
    );
    const afterRelease: TasksViewRead = {
      ...initial,
      availableBounties: [offering],
      bountyClaims: [],
      progress: initial.progress.map((row) =>
        row.member === "dad" ? { ...row, total: 0 } : row,
      ),
    };
    const replacement = {
      kind: "claimed-bounty",
      claim: {
        ...firstClaim.claim,
        id: "claim-release-second",
        member: "ellie",
      },
      revision: 0,
      state: { kind: "unfinished" },
    } as ClaimedBounty;
    const afterReclaim: TasksViewRead = {
      ...afterRelease,
      availableBounties: [],
      bountyClaims: [replacement],
      progress: afterRelease.progress.map((row) =>
        row.member === "ellie" ? { ...row, total: 1 } : row,
      ),
    };
    const afterComplete: TasksViewRead = {
      ...afterReclaim,
      bountyClaims: [
        {
          ...replacement,
          revision: 1,
          state: {
            kind: "completed",
            completion: {
              id: "completion-release-second",
              claim: replacement.claim.id,
              by: "ellie",
              at: initial.generatedAt,
              creditedStars: replacement.claim.stars,
            },
          },
        } as ClaimedBounty,
      ],
      progress: afterReclaim.progress.map((row) =>
        row.member === "ellie" ? { ...row, done: 1 } : row,
      ),
    };
    const fetchMock = installScriptedBountyFetch(
      [initial, afterRelease, afterReclaim, afterComplete],
      [
        { method: "PATCH", response: { receipt: { status: "accepted" } } },
        { method: "PATCH", response: { receipt: { status: "accepted" } } },
        { method: "PATCH", response: { receipt: { status: "accepted" } } },
      ],
    );
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    expect(
      screen.queryByRole("button", { name: "Skip Sweep steps" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Release Sweep steps" }),
    );
    await user.click(screen.getByRole("button", { name: "Bounties" }));
    expect(await screen.findByText("Sweep steps")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Claim Sweep steps" }));
    await user.click(screen.getByRole("button", { name: "Ellie" }));
    await user.click(
      screen.getByRole("button", { name: "View tasks for Ellie" }),
    );
    expect(await screen.findByText("Sweep steps")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Sweep steps" }));
    expect(
      screen.queryByRole("checkbox", { name: "Sweep steps" }),
    ).not.toBeInTheDocument();

    const patches = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(
        ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
    expect(patches[0]).toMatchObject({
      kind: "release-bounty",
      claim: firstClaim.claim.id,
      revision: 0,
    });
    expect(patches[1]).toMatchObject({
      kind: "claim-bounty",
      offering: offering.offering,
      member: "ellie",
      definitionRevision: offering.definitionRevision,
    });
    expect(patches[2]).toMatchObject({
      kind: "complete-bounty",
      claim: replacement.claim.id,
      revision: 0,
    });
    for (const patch of patches) {
      expect(patch.requestId).toMatch(/^[a-f0-9]{32}$/);
    }
  });

  test("guards one Bounty offering through claim refresh while others remain usable", async () => {
    const initial = emptyView();
    const offerings = ["Wash windows", "Sweep porch"].map(
      (title, index) =>
        ({
          kind: "available",
          id: `guard-offering-${index}`,
          offering: {
            kind: "once",
            definition: `guard-definition-${index}`,
          },
          title,
          stars: index + 1,
          definitionRevision: 0,
        }) as AvailableBounty,
    );
    initial.availableBounties = offerings;
    let finishRefresh: ((response: Response) => void) | undefined;
    const refresh = new Promise<Response>((resolve) => {
      finishRefresh = resolve;
    });
    let taskReads = 0;
    let patches = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.endsWith("/api/tasks")) {
          taskReads += 1;
          return taskReads === 1 ? json(initial) : refresh;
        }
        if (method === "PATCH" && url.endsWith("/api/tasks")) {
          patches += 1;
          return json({ receipt: { status: "accepted" } });
        }
        throw new Error(`Unexpected ${method} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Bounties" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Claim Wash windows" }),
    );
    const dad = screen.getByRole("button", { name: "Dad" });
    act(() => {
      dad.click();
      dad.click();
    });

    await waitFor(() => expect(patches).toBe(1));
    expect(
      screen.getByRole("button", { name: "Claim Wash windows" }),
    ).toBeDisabled();
    const other = screen.getByRole("button", { name: "Claim Sweep porch" });
    expect(other).toBeEnabled();
    await userEvent.click(other);
    expect(screen.getByRole("dialog", { name: "Claim Bounty" })).toBeVisible();

    if (!finishRefresh) throw new Error("Missing deferred refresh resolver");
    finishRefresh(
      json({
        ...initial,
        availableBounties: [offerings[1]],
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Claim Wash windows" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Could not claim Bounty."),
    ).not.toBeInTheDocument();
  });

  test("Bounties stay available without Active Members and explain the claim requirement", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    const definition = {
      kind: "bounty",
      id: "bounty-empty-roster",
      lineage: "lineage-empty-roster",
      type: "chore",
      title: "Clear porch",
      stars: 2,
      recurrence: { kind: "once" },
      revision: 0,
      retiredAt: null,
    } as BountyDefinition;
    store.bountyDefinitions = [definition];
    store.availableBounties = [
      {
        kind: "available",
        id: "offering-empty-roster",
        offering: { kind: "once", definition: definition.id },
        title: definition.title,
        stars: definition.stars,
        definitionRevision: definition.revision,
      } as AvailableBounty,
    ];
    installFetch(store, {
      ...settings,
      members: [{ id: "former", name: "Former", status: "retired" }],
    });
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Bounties" }));
    await user.click(screen.getByRole("button", { name: "Claim Clear porch" }));
    expect(
      screen.getByText(
        "Add an Active Member under Settings before claiming a Bounty.",
      ),
    ).toBeVisible();
    const closeButton = within(
      screen.getByRole("dialog", { name: "Claim Bounty" }),
    )
      .getAllByRole("button", { name: "Close" })
      .at(-1);
    expect(closeButton).toBeDefined();
    if (!closeButton) throw new Error("Missing close button");
    await user.click(closeButton);
    expect(
      screen.queryByRole("button", { name: "Add Bounty" }),
    ).not.toBeInTheDocument();
  });

  test("a competing Bounty claim remains visible as an error after refresh", async () => {
    const user = userEvent.setup();
    const initial = emptyView();
    const definition = {
      kind: "bounty",
      id: "bounty-competing",
      lineage: "lineage-competing",
      type: "chore",
      title: "Claimed elsewhere",
      stars: 1,
      recurrence: { kind: "once" },
      revision: 0,
      retiredAt: null,
    } as BountyDefinition;
    initial.bountyDefinitions = [definition];
    initial.availableBounties = [
      {
        kind: "available",
        id: "offering-competing",
        offering: { kind: "once", definition: definition.id },
        title: definition.title,
        stars: definition.stars,
        definitionRevision: definition.revision,
      } as AvailableBounty,
    ];
    installScriptedBountyFetch(
      [initial, { ...initial, availableBounties: [] }],
      [
        {
          method: "PATCH",
          status: 409,
          response: { error: "Bounty already claimed" },
        },
      ],
    );
    render(<TasksScreen />);

    await user.click(await screen.findByRole("button", { name: "Bounties" }));
    await user.click(
      screen.getByRole("button", { name: "Claim Claimed elsewhere" }),
    );
    await user.click(screen.getByRole("button", { name: "Dad" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not claim Bounty.",
    );
    expect(screen.queryByText("Claimed elsewhere")).not.toBeInTheDocument();
  });

  test("a stale Bounty completion remains visible as an error after refresh", async () => {
    const user = userEvent.setup();
    const initial = emptyView();
    const claim = {
      kind: "claimed-bounty",
      claim: {
        id: "claim-stale",
        offering: { kind: "once", definition: "bounty-stale" },
        member: "dad",
        scheduledOn: initial.today,
        title: "Already finished",
        stars: 2,
      },
      revision: 0,
      state: { kind: "unfinished" },
    } as ClaimedBounty;
    initial.bountyClaims = [claim];
    initial.progress = initial.progress.map((row) =>
      row.member === "dad" ? { ...row, total: 1 } : row,
    );
    const refreshed: TasksViewRead = {
      ...initial,
      bountyClaims: [
        {
          ...claim,
          state: {
            kind: "completed",
            completion: {
              id: "completion-stale",
              claim: claim.claim.id,
              by: "dad",
              at: initial.generatedAt,
              creditedStars: claim.claim.stars,
            },
          },
        } as ClaimedBounty,
      ],
      progress: initial.progress.map((row) =>
        row.member === "dad" ? { ...row, done: 1 } : row,
      ),
    };
    installScriptedBountyFetch(
      [initial, refreshed],
      [
        {
          method: "PATCH",
          status: 409,
          response: { error: "stale claim revision" },
        },
      ],
    );
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Already finished" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not complete Bounty.",
    );
    expect(
      screen.queryByRole("checkbox", { name: "Already finished" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "All done!" }),
    ).not.toBeInTheDocument();
  });

  test("reopened Bounty work appears with normal Complete and Release actions", async () => {
    const user = userEvent.setup();
    const initial = emptyView();
    const reopened = {
      kind: "claimed-bounty",
      claim: {
        id: "claim-reopened",
        offering: { kind: "once", definition: "bounty-reopened" },
        member: "dad",
        scheduledOn: initial.today,
        title: "Wash car again",
        stars: 4,
      },
      revision: 2,
      state: {
        kind: "reopened",
        undoneCompletion: {
          id: "completion-undone",
          claim: "claim-reopened",
          by: "dad",
          at: initial.generatedAt,
          creditedStars: 4,
          creditProvenance: "recorded",
        },
        correction: "correction-undo",
      },
    } as ClaimedBounty;
    initial.bountyClaims = [reopened];
    initial.progress = initial.progress.map((row) =>
      row.member === "dad" ? { ...row, total: 1 } : row,
    );
    const completed: TasksViewRead = {
      ...initial,
      bountyClaims: [
        {
          ...reopened,
          revision: 3,
          state: {
            kind: "completed",
            completion: {
              id: "completion-new",
              claim: reopened.claim.id,
              by: "dad",
              at: initial.generatedAt,
              creditedStars: 4,
              creditProvenance: "recorded",
            },
            creditedTo: "dad",
            correction: null,
          },
        } as ClaimedBounty,
      ],
      progress: initial.progress.map((row) =>
        row.member === "dad" ? { ...row, done: 1 } : row,
      ),
    };
    const fetchMock = installScriptedBountyFetch(
      [initial, completed],
      [{ method: "PATCH", response: { receipt: { status: "accepted" } } }],
    );
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    expect(
      screen.getByRole("button", { name: "Release Wash car again" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Wash car again" }));
    const mutation = fetchMock.mock.calls.find(
      ([input, init]) =>
        urlOf(input).endsWith("/api/tasks") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(mutation?.[1]?.body))).toMatchObject({
      kind: "complete-bounty",
      claim: "claim-reopened",
      revision: 2,
    });
    expect(await screen.findByText("1 completed or skipped")).toBeVisible();
  });

  test("Stars requests a numeric keyboard and replaces its value when tapped", async () => {
    const user = userEvent.setup();
    installFetch(emptyView());
    render(<TasksScreen />);
    await user.click(await screen.findByRole("button", { name: "Add task" }));
    const stars = screen.getByRole("textbox", { name: "Stars" });
    expect(stars).toHaveAttribute("inputmode", "numeric");
    await user.click(stars);
    await user.keyboard("12");
    expect(stars).toHaveValue("12");
    await user.click(stars);
    await user.keyboard("5");
    expect(stars).toHaveValue("5");
  });

  test("the editor reserves space for the kiosk keyboard and restores it when removed", async () => {
    const user = userEvent.setup();
    installFetch(emptyView());
    render(<TasksScreen />);
    await user.click(await screen.findByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "New task" });
    expect(within(dialog).getByLabelText("Task title")).toBeVisible();
    const keyboard = document.createElement("div");
    keyboard.id = "familyos-osk";
    keyboard.getBoundingClientRect = () =>
      new DOMRect(0, window.innerHeight - 300, 1024, 300);
    try {
      document.documentElement.appendChild(keyboard);
      await waitFor(() =>
        expect(dialog.parentElement).toHaveStyle("--editor-bottom: 300px"),
      );
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeVisible();
    } finally {
      keyboard.remove();
    }
    await waitFor(() =>
      expect(dialog.parentElement).toHaveStyle("--editor-bottom: 0px"),
    );
  });

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
    const stars = screen.getByRole("textbox", { name: "Stars" });
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
    const stars = screen.getByRole("textbox", { name: "Stars" });
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
    const stars = screen.getByRole("textbox", { name: "Stars" });
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

  test("household work is available only through Bounties", async () => {
    const user = userEvent.setup();
    const store = emptyView();
    store.occurrences = [
      {
        state: "pending",
        task: "legacy-open" as Occurrence["task"],
        window: store.today,
        title: "Legacy open work",
        type: "chore",
        lineage: "legacy-open-lineage" as Occurrence["lineage"],
        time: null,
        assignee: null,
      },
    ];
    installFetch(store);
    render(<TasksScreen />);

    expect(
      await screen.findByRole("button", { name: "Bounties" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Household" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy open work")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(
      screen.queryByRole("button", { name: "Household" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fixed" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rotation" })).toBeVisible();
  });

  test("completing a task tucks it below remaining work in the finished section", async () => {
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
    expect(after[1]?.closest("details")).not.toHaveAttribute("open");
    await user.click(screen.getByText("1 completed or skipped"));
    expect(after[1]).toBeVisible();
    expect(after[1]).toBeDisabled();
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
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );

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
      await screen.findByRole("button", { name: "View tasks for Ellie" }),
    );

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

    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );

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
    const definition: LegacyTaskDefinition = {
      id: "edit-me" as LegacyTaskDefinition["id"],
      lineage: "lin-edit" as LegacyTaskDefinition["lineage"],
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
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit Dishes" }));
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
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit Dishes" }));
    const title = screen.getByPlaceholderText("Title");
    await user.clear(title);
    await user.type(title, "Kitchen");
    await user.click(screen.getByRole("button", { name: "Ellie" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await user.click(
      screen.getByRole("button", { name: "View tasks for Ellie" }),
    );
    expect(await screen.findByText("Kitchen")).toBeInTheDocument();
    expect(screen.queryByText("Dishes")).not.toBeInTheDocument();
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

describe("Family Board navigation", () => {
  function boardView() {
    const store = emptyView();
    store.occurrences = ["Dishes", "Laundry", "Water plants", "Pack lunch"].map(
      (title, index) => ({
        state: "pending",
        task: `board-${index}` as Occurrence["task"],
        lineage: `board-${index}` as Occurrence["lineage"],
        window: store.today,
        title,
        type: "chore",
        time: null,
        assignee: "dad",
      }),
    );
    store.progress = [
      { member: "dad", done: 0, total: 4 },
      { member: "ellie", done: 0, total: 0 },
    ];
    return store;
  }

  test("only the member header opens personal focus; the board previews three tasks", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(boardView());
    render(<TasksScreen />);
    await screen.findByRole("button", { name: "View tasks for Dad" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByText("Pack lunch")).not.toBeInTheDocument();
    await user.click(screen.getByText("Dishes"));
    expect(screen.getByRole("heading", { name: "Family Board" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Dishes" }));
    expect(await screen.findByText("Pack lunch")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Family Board" })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "View tasks for Dad" }),
    );
    expect(screen.getByRole("heading", { name: "Dad’s tasks" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Family Board" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip Pack lunch" }),
    ).toBeVisible();
    const writes = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(writes).toHaveLength(1);
  });

  test("the more-tasks link opens the full list and the back button restores the board", async () => {
    const user = userEvent.setup();
    installFetch(boardView());
    render(<TasksScreen />);
    await user.click(
      await screen.findByRole("button", { name: "1 more task" }),
    );
    expect(screen.getByRole("checkbox", { name: "Pack lunch" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Family Board" }));
    expect(screen.getByRole("heading", { name: "Family Board" })).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "Pack lunch" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "View tasks for Dad" }),
      ).toHaveFocus(),
    );
  });

  test("opening Bounties resets the board scroll position", async () => {
    const user = userEvent.setup();
    installFetch(boardView());
    render(<TasksScreen />);
    const heading = await screen.findByRole("heading", {
      name: "Family Board",
    });
    const scroll = heading.parentElement?.nextElementSibling;
    expect(scroll).toBeInstanceOf(HTMLElement);
    if (!(scroll instanceof HTMLElement))
      throw new Error("Missing board scroll");
    scroll.scrollTop = 240;

    await user.click(screen.getByRole("button", { name: "Bounties" }));

    await waitFor(() => expect(scroll.scrollTop).toBe(0));
  });

  test("the board caps the combined assigned and claimed Bounty preview", async () => {
    const user = userEvent.setup();
    const store = boardView();
    store.bountyClaims = ["Wash car", "Mow lawn"].map(
      (title, index) =>
        ({
          kind: "claimed-bounty",
          claim: {
            id: `board-claim-${index}`,
            offering: {
              kind: "once",
              definition: `board-bounty-${index}`,
            },
            member: "dad",
            scheduledOn: store.today,
            title,
            stars: index,
          },
          revision: 0,
          state: { kind: "unfinished" },
        }) as ClaimedBounty,
    );
    store.progress = store.progress.map((row) =>
      row.member === "dad" ? { ...row, total: 6 } : row,
    );
    installFetch(store);
    render(<TasksScreen />);

    await screen.findByRole("button", { name: "View tasks for Dad" });
    const dadPreview = screen.getByRole("region", { name: "Dad tasks" });
    expect(within(dadPreview).getAllByRole("checkbox")).toHaveLength(3);
    expect(
      within(dadPreview).getByRole("button", { name: "3 more tasks" }),
    ).toBeVisible();

    await user.click(
      within(dadPreview).getByRole("button", { name: "3 more tasks" }),
    );
    expect(screen.getByRole("heading", { name: "Dad’s tasks" })).toBeVisible();
    expect(screen.getByText("6 remaining")).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    for (const title of [
      "Wash car",
      "Mow lawn",
      "Dishes",
      "Laundry",
      "Water plants",
      "Pack lunch",
    ]) {
      expect(screen.getByRole("checkbox", { name: title })).toBeVisible();
    }
  });

  test("member switching keeps the focus view and shows an empty member accurately", async () => {
    const user = userEvent.setup();
    installFetch(boardView());
    render(<TasksScreen />);
    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    await user.click(
      screen.getByRole("button", { name: "View tasks for Ellie" }),
    );
    expect(
      screen.getByRole("heading", { name: "Ellie’s tasks" }),
    ).toBeVisible();
    expect(screen.getByText("No tasks today")).toBeVisible();
    expect(screen.queryByText("All done for today")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "View tasks for Dad" }),
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  test("completion in focus updates progress and survives returning to the board", async () => {
    const user = userEvent.setup();
    installFetch(boardView());
    render(<TasksScreen />);
    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Pack lunch" }));
    expect(await screen.findByText("3 remaining")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Dad’s tasks" })).toBeVisible();
    await user.click(screen.getByText("1 completed or skipped"));
    expect(screen.getByRole("checkbox", { name: "Pack lunch" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Family Board" }));
    expect(screen.getByRole("region", { name: "Dad tasks" })).toHaveTextContent(
      "1/4 done",
    );
  });
});

describe("daily completion celebration", () => {
  function dailyTasks() {
    const store = emptyView();
    store.occurrences = ["Dishes", "Laundry"].map((title, index) => ({
      state: "pending",
      task: `daily-${index}` as Occurrence["task"],
      lineage: `daily-${index}` as Occurrence["lineage"],
      window: store.today,
      title,
      type: "chore",
      time: null,
      assignee: "dad",
    }));
    store.progress = [{ member: "dad", done: 0, total: 2 }];
    return store;
  }

  function bountyTask() {
    const store = emptyView();
    const claimed = {
      kind: "claimed-bounty",
      claim: {
        id: "celebration-claim",
        offering: { kind: "once", definition: "celebration-bounty" },
        member: "dad",
        scheduledOn: store.today,
        title: "Polish table",
        stars: 2,
      },
      revision: 0,
      state: { kind: "unfinished" },
    } as ClaimedBounty;
    store.bountyClaims = [claimed];
    store.progress = [{ member: "dad", done: 0, total: 1 }];
    return { store, claimed };
  }

  test("celebrates only the last confirmed task and can be dismissed", async () => {
    const user = userEvent.setup();
    installFetch(dailyTasks());
    render(<TasksScreen />);
    await user.click(await screen.findByRole("checkbox", { name: "Dishes" }));
    expect(
      screen.queryByRole("dialog", { name: "All done!" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Laundry" }));
    expect(
      await screen.findByRole("dialog", { name: "All done!" }),
    ).toHaveTextContent("You did it, Dad!");
    await user.click(
      screen.getByRole("button", { name: "Dismiss celebration" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "All done!" }),
    ).not.toBeInTheDocument();
  });

  test("automatically dismisses after the fanfare", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(
      <TaskCelebration
        member={{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }}
        onDismiss={dismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(6500);
    });
    expect(dismiss).toHaveBeenCalledOnce();
  });

  test("opening an already completed day does not celebrate", async () => {
    const store = dailyTasks();
    for (const row of store.occurrences)
      Object.assign(store, markDone(store, row));
    installFetch(store);
    render(<TasksScreen />);
    await screen.findByText("Laundry");
    expect(
      screen.queryByRole("dialog", { name: "All done!" }),
    ).not.toBeInTheDocument();
  });

  test("a failed final completion does not celebrate", async () => {
    const store = dailyTasks();
    Object.assign(store, markDone(store, store.occurrences[0]));
    const fetchMock = installFetch(store);
    const successfulFetch = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST") return json({ error: "Unavailable" }, 500);
      if (!successfulFetch) throw new Error("Missing fetch fixture");
      return successfulFetch(input, init);
    });
    const user = userEvent.setup();
    render(<TasksScreen />);
    await user.click(await screen.findByRole("checkbox", { name: "Laundry" }));
    await screen.findByRole("checkbox", { name: "Laundry" });
    expect(
      screen.queryByRole("dialog", { name: "All done!" }),
    ).not.toBeInTheDocument();
  });

  test("celebrates when a confirmed Bounty completes the member's last work", async () => {
    const user = userEvent.setup();
    const { store, claimed } = bountyTask();
    const completed: TasksViewRead = {
      ...store,
      bountyClaims: [
        {
          ...claimed,
          state: {
            kind: "completed",
            completion: {
              id: "celebration-completion",
              claim: claimed.claim.id,
              by: "dad",
              at: store.generatedAt,
              creditedStars: claimed.claim.stars,
            },
          },
        } as ClaimedBounty,
      ],
      progress: [{ member: "dad", done: 1, total: 1 }],
    };
    installScriptedBountyFetch(
      [store, completed],
      [{ method: "PATCH", response: { receipt: { status: "accepted" } } }],
    );
    render(<TasksScreen />);

    await user.click(
      await screen.findByRole("checkbox", { name: "Polish table" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "All done!" }),
    ).toHaveTextContent("You did it, Dad!");
  });

  test("guards a Bounty completion while its request and refresh are pending", async () => {
    const user = userEvent.setup();
    const { store } = bountyTask();
    let settleFirst: ((response: Response) => void) | undefined;
    const firstPatch = new Promise<Response>((resolve) => {
      settleFirst = resolve;
    });
    let patchCount = 0;
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
        if (method === "PATCH" && url.endsWith("/api/tasks")) {
          patchCount += 1;
          return patchCount === 1
            ? firstPatch
            : json({ error: "stale claim revision" }, 409);
        }
        throw new Error(`Unexpected ${method} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksScreen />);
    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    const checkbox = await screen.findByRole("checkbox", {
      name: "Polish table",
    });
    const release = screen.getByRole("button", {
      name: "Release Polish table",
    });

    fireEvent.click(checkbox);
    fireEvent.click(release);

    expect(checkbox).toBeDisabled();
    expect(release).toBeDisabled();
    expect(patchCount).toBe(1);
    if (!settleFirst) throw new Error("Missing deferred response resolver");
    settleFirst(json({ error: "stale claim revision" }, 409));
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(release).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not complete Bounty.",
    );

    await user.click(checkbox);
    await waitFor(() => expect(patchCount).toBe(2));
  });

  test("guards a Bounty release per Claim while its request and refresh are pending", async () => {
    const user = userEvent.setup();
    const { store, claimed } = bountyTask();
    store.bountyClaims.push({
      ...claimed,
      claim: {
        ...claimed.claim,
        id: "other-pending-claim" as ClaimedBounty["claim"]["id"],
        title: "Dust shelves" as ClaimedBounty["claim"]["title"],
      },
    });
    store.progress = [{ member: "dad", done: 0, total: 2 }];
    let settleFirst: ((response: Response) => void) | undefined;
    const firstPatch = new Promise<Response>((resolve) => {
      settleFirst = resolve;
    });
    let patchCount = 0;
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
        if (method === "PATCH" && url.endsWith("/api/tasks")) {
          patchCount += 1;
          return patchCount === 1
            ? firstPatch
            : json({ error: "stale claim revision" }, 409);
        }
        throw new Error(`Unexpected ${method} ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TasksScreen />);
    await user.click(
      await screen.findByRole("button", { name: "View tasks for Dad" }),
    );
    const release = screen.getByRole("button", {
      name: "Release Polish table",
    });
    const checkbox = screen.getByRole("checkbox", { name: "Polish table" });

    fireEvent.click(release);
    fireEvent.click(release);

    expect(release).toBeDisabled();
    expect(checkbox).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Release Dust shelves" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Dust shelves" }),
    ).toBeEnabled();
    expect(patchCount).toBe(1);
    if (!settleFirst) throw new Error("Missing deferred response resolver");
    settleFirst(json({ error: "stale claim revision" }, 409));
    await waitFor(() => expect(release).toBeEnabled());
    expect(checkbox).toBeEnabled();

    await user.click(release);
    await waitFor(() => expect(patchCount).toBe(2));
  });
});
