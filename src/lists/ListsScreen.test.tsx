// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { HouseholdList, ListItem } from "@/lists/types";
import type { PublicSettings } from "@/settings/types";
import { ListsScreen } from "./ListsScreen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settings: PublicSettings = {
  familyName: "Test",
  members: [],
  calendarId: null,
  listIds: ["tl-1"],
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

function installFetch(lists: HouseholdList[]) {
  const store = structuredClone(lists);
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/lists")) {
        return json({ lists: store, stale: false });
      }

      const itemMatch = url.match(/\/api\/lists\/([^/]+)\/items\/([^/?]+)$/);
      if (itemMatch) {
        const listId = decodeURIComponent(itemMatch[1] ?? "");
        const itemId = decodeURIComponent(itemMatch[2] ?? "");
        const list = store.find((l) => l.id === listId);
        const item = list?.items.find((i) => i.id === itemId);
        if (method === "PATCH") {
          const body = JSON.parse(
            String(init?.body ?? "{}"),
          ) as Partial<ListItem>;
          if (!item) return json({ error: "missing" }, 404);
          if (
            body.expectedVersion !== undefined &&
            body.expectedVersion !== item.expectedVersion
          ) {
            return json({ error: "version", item: { ...item } }, 409);
          }
          const { expectedVersion: _ignored, ...fields } = body;
          Object.assign(item, fields);
          item.expectedVersion = `${item.expectedVersion}+`;
          return json({ item: { ...item } });
        }
        if (method === "DELETE") {
          if (!list || !item) return json({ error: "missing" }, 404);
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            expectedVersion?: string;
          };
          if (
            body.expectedVersion !== undefined &&
            body.expectedVersion !== item.expectedVersion
          ) {
            return json({ error: "version", item: { ...item } }, 409);
          }
          list.items = list.items.filter((i) => i.id !== itemId);
          return json({ ok: true });
        }
      }

      const addMatch = url.match(/\/api\/lists\/([^/]+)\/items$/);
      if (addMatch && method === "POST") {
        const listId = decodeURIComponent(addMatch[1] ?? "");
        const list = store.find((l) => l.id === listId);
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          title: string;
        };
        const item: ListItem = {
          id: `new-${body.title}`,
          title: body.title,
          done: false,
          expectedVersion: "v-new",
        };
        list?.items.unshift(item);
        return json({ item });
      }

      const clearMatch = url.match(/\/api\/lists\/([^/]+)\/clear$/);
      if (clearMatch && method === "POST") {
        const listId = decodeURIComponent(clearMatch[1] ?? "");
        const list = store.find((l) => l.id === listId);
        if (list) list.items = list.items.filter((i) => !i.done);
        return json({ ok: true });
      }

      return json({ error: `unhandled ${method} ${url}` }, 500);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { store, fetchMock };
}

const grocery: HouseholdList = {
  id: "tl-1",
  title: "Grocery",
  items: [{ id: "i1", title: "Milk", done: false, expectedVersion: "v1" }],
};

async function renderGrocery(lists: HouseholdList[] = [grocery]) {
  installFetch(lists);
  render(<ListsScreen />);
  await screen.findByRole("button", { name: "Grocery" });
}

describe("ListsScreen List Item lifecycle", () => {
  test("a List Item can be renamed from the wall", async () => {
    const user = userEvent.setup();
    await renderGrocery();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    expect(
      await screen.findByRole("heading", { name: "List Item" }),
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Name");
    await user.clear(input);
    await user.type(input, "Oat milk");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Oat milk" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "List Item" })).toBeNull();
  });

  test("press-and-hold keeps the List Item sheet open", async () => {
    await renderGrocery();
    vi.useFakeTimers();
    const row = screen.getByRole("button", { name: "Milk" });
    fireEvent.pointerDown(row, { clientX: 0, clientY: 0 });
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByRole("heading", { name: "List Item" })).toBeNull();

    fireEvent.pointerUp(row);
    expect(
      screen.getByRole("heading", { name: "List Item" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(
      screen.getByRole("heading", { name: "List Item" }),
    ).toBeInTheDocument();
  });

  test("a List Item can be deleted from the wall", async () => {
    const user = userEvent.setup();
    await renderGrocery();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    await screen.findByRole("heading", { name: "List Item" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete List Item?" }));

    expect(screen.queryByRole("button", { name: "Milk" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "List Item" })).toBeNull();
  });

  test("a List Item can be added, checked, unchecked, and cleared", async () => {
    const user = userEvent.setup();
    await renderGrocery([{ id: "tl-1", title: "Grocery", items: [] }]);

    await user.type(screen.getByPlaceholderText("Add item"), "Bread");
    await user.keyboard("{Enter}");
    const row = await screen.findByRole("button", { name: "Bread" });
    expect(screen.getByText("Bread")).toHaveStyle({ textDecoration: "none" });

    await user.click(row);
    expect(screen.getByText("Bread")).toHaveStyle({
      textDecoration: "line-through",
    });

    await user.click(screen.getByRole("button", { name: "Bread" }));
    expect(screen.getByText("Bread")).toHaveStyle({ textDecoration: "none" });

    await user.click(screen.getByRole("button", { name: "Bread" }));
    await user.click(screen.getByRole("button", { name: "Clear checked" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Bread" })).toBeNull();
    });
  });

  test("a failed check does not stay marked complete", async () => {
    const user = userEvent.setup();
    let releasePatch: (result: Promise<Response>) => void = () => {};
    const patchGate = new Promise<Response>((resolve, reject) => {
      releasePatch = (result) => {
        result.then(resolve, reject);
      };
    });
    const { fetchMock } = installFetch([grocery]);
    fetchMock.mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/lists")) {
        return json({ lists: [grocery] });
      }
      if (method === "PATCH") return patchGate;
      return json({ error: "unhandled" }, 500);
    });
    render(<ListsScreen />);
    const click = user.click(
      await screen.findByRole("button", { name: "Milk" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Milk")).toHaveStyle({
        textDecoration: "line-through",
      });
    });
    releasePatch(Promise.reject(new TypeError("Failed to fetch")));
    await click;
    await waitFor(() => {
      expect(screen.getByText("Milk")).toHaveStyle({
        textDecoration: "none",
      });
    });
  });

  test("a failed rename does not change the List Item title", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installFetch([grocery]);
    render(<ListsScreen />);
    await screen.findByRole("button", { name: "Milk" });
    fetchMock.mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/lists")) {
        return json({ lists: [grocery] });
      }
      if (method === "PATCH") return json({ error: "failed" }, 500);
      return json({ error: "unhandled" }, 500);
    });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    const input = await screen.findByPlaceholderText("Name");
    await user.clear(input);
    await user.type(input, "Oat milk");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Could not rename List Item."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Milk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Oat milk" })).toBeNull();
  });

  test("a failed delete leaves the List Item on the wall", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installFetch([grocery]);
    render(<ListsScreen />);
    await screen.findByRole("button", { name: "Milk" });
    fetchMock.mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/lists")) {
        return json({ lists: [grocery] });
      }
      if (method === "DELETE") return json({ error: "failed" }, 500);
      return json({ error: "unhandled" }, 500);
    });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete List Item?" }));

    expect(
      await screen.findByText("Could not delete List Item."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Milk" })).toBeInTheDocument();
  });

  test("a stale check reloads the current List Item instead of keeping the write", async () => {
    const user = userEvent.setup();
    const current: ListItem = {
      id: "i1",
      title: "Oat milk",
      done: false,
      expectedVersion: "v2",
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.endsWith("/api/lists")) {
          return json({ lists: [grocery], stale: false });
        }
        if (method === "PATCH") {
          return json({ error: "version", item: current }, 409);
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ListsScreen />);
    await user.click(await screen.findByRole("button", { name: "Milk" }));
    expect(
      await screen.findByRole("button", { name: "Oat milk" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Milk" })).toBeNull();
    expect(screen.getByText("Oat milk")).toHaveStyle({
      textDecoration: "none",
    });
    expect(
      screen.getByText(
        "This List Item changed on another Display. Reloaded — try again.",
      ),
    ).toBeInTheDocument();
  });

  test("a stale rename reloads the current List Item title", async () => {
    const user = userEvent.setup();
    const current: ListItem = {
      id: "i1",
      title: "Oat milk",
      done: false,
      expectedVersion: "v2",
    };
    const { fetchMock } = installFetch([grocery]);
    render(<ListsScreen />);
    await screen.findByRole("button", { name: "Milk" });
    fetchMock.mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/lists")) {
        return json({ lists: [grocery], stale: false });
      }
      if (method === "PATCH") {
        return json({ error: "version", item: current }, 409);
      }
      return json({ error: "unhandled" }, 500);
    });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    const input = await screen.findByPlaceholderText("Name");
    await user.clear(input);
    await user.type(input, "Almond");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Oat milk" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Almond" })).toBeNull();
    expect(screen.getByPlaceholderText("Name")).toHaveValue("Oat milk");
    expect(
      screen.getByText(
        "This List Item changed on another Display. Reloaded — try again.",
      ),
    ).toBeInTheDocument();
  });

  test("a stale uncheck reloads the current checked List Item", async () => {
    const user = userEvent.setup();
    const checkedGrocery: HouseholdList = {
      id: "tl-1",
      title: "Grocery",
      items: [{ id: "i1", title: "Milk", done: true, expectedVersion: "v1" }],
    };
    const current: ListItem = {
      id: "i1",
      title: "Oat milk",
      done: true,
      expectedVersion: "v2",
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.endsWith("/api/lists")) {
          return json({ lists: [checkedGrocery], stale: false });
        }
        if (method === "PATCH") {
          return json({ error: "version", item: current }, 409);
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ListsScreen />);
    await user.click(await screen.findByRole("button", { name: "Milk" }));
    expect(
      await screen.findByRole("button", { name: "Oat milk" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Oat milk")).toHaveStyle({
      textDecoration: "line-through",
    });
  });

  test("a conflict without a current item does not remove the List Item", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.endsWith("/api/lists")) {
          return json({ lists: [grocery], stale: false });
        }
        if (method === "PATCH") {
          return json({ error: "version" }, 409);
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ListsScreen />);
    await user.click(await screen.findByRole("button", { name: "Milk" }));
    expect(
      await screen.findByRole("button", { name: "Milk" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Milk")).toHaveStyle({ textDecoration: "none" });
  });

  test("a stale delete leaves the current List Item on the wall", async () => {
    const user = userEvent.setup();
    const current: ListItem = {
      id: "i1",
      title: "Oat milk",
      done: false,
      expectedVersion: "v2",
    };
    const { fetchMock } = installFetch([grocery]);
    render(<ListsScreen />);
    await screen.findByRole("button", { name: "Milk" });
    fetchMock.mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/lists")) {
        return json({ lists: [grocery], stale: false });
      }
      if (method === "DELETE") {
        return json({ error: "version", item: current }, 409);
      }
      return json({ error: "unhandled" }, 500);
    });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete List Item?" }));

    expect(
      await screen.findByRole("button", { name: "Oat milk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This List Item changed on another Display. Reloaded — try again.",
      ),
    ).toBeInTheDocument();
  });
});

describe("ListsScreen outage cache", () => {
  test("stale Household Lists stay visible and cannot be mutated", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.endsWith("/api/lists")) {
          return json({ lists: [grocery], stale: true });
        }
        return json({ error: "read-only" }, 503);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ListsScreen />);

    expect(
      await screen.findByRole("heading", { name: "Grocery" }),
    ).toBeVisible();
    expect(
      screen.getByText("Google is unavailable. Lists are read-only."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add list" })).toBeNull();
    expect(screen.queryByPlaceholderText("Add item")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear checked" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Milk" }));
    expect(screen.getByText("Milk")).toHaveStyle({ textDecoration: "none" });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Milk" }),
    });
    expect(screen.queryByRole("heading", { name: "List Item" })).toBeNull();
  });

  test("disconnected Displays still show matching cached Household Lists", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json({ ...settings, signedIn: false });
        }
        if (method === "GET" && url.endsWith("/api/lists")) {
          return json({ lists: [grocery], stale: true });
        }
        return json({ error: "unhandled" }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ListsScreen />);

    expect(
      await screen.findByRole("heading", { name: "Grocery" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Milk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add list" })).toBeNull();
  });
});
