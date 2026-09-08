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
import {
  LEGACY_TONE_COLORS,
  MAX_ACTIVE_MEMBERS,
  type Member,
} from "@/members/members";
import type { PublicSettings } from "@/settings/types";
import { SettingsScreen } from "./SettingsScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ada: Member = {
  id: "ada",
  name: "Ada",
  status: "active",
  color: "#a9d8d2",
};
const ben: Member = {
  id: "ben",
  name: "Ben",
  status: "active",
  color: "#f6c9c5",
};
const cara: Member = { id: "cara", name: "Cara", status: "retired" };

function publicSettings(members: Member[]): PublicSettings {
  return {
    familyName: "Test",
    members,
    calendarId: null,
    listIds: [],
    timeZone: "America/New_York",
    signedIn: false,
    googleConfigured: true,
    uiScale: 1,
    idleDimAfterMs: 300_000,
    idleDimTo: 10,
    configVersion: 1,
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

function installFetch(
  settings: PublicSettings,
  options?: { patch?: (body: unknown) => Response },
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return json(settings);
      }
      if (method === "GET" && url.endsWith("/api/displays")) {
        return json({ displays: [], currentDisplayId: "d1" });
      }
      if (method === "POST" && url.endsWith("/api/displays/pairing-code")) {
        return json({
          code: "ABC234",
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      }
      if (method === "POST" && url.endsWith("/api/settings/update")) {
        return json({ ok: true }, 202);
      }
      if (method === "PATCH" && url.endsWith("/api/settings")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (options?.patch) return options.patch(body);
        return json({ ...settings, ...body, configVersion: 2 });
      }
      return json({ error: `unhandled ${method} ${url}` }, 500);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderSettings(members: Member[] = [ada, ben, cara]) {
  installFetch(publicSettings(members));
  render(<SettingsScreen />);
  await screen.findByDisplayValue("Ada");
}

describe("Settings Member Color and retirement", () => {
  test("Active Members pick any #rrggbb Member Color", async () => {
    await renderSettings();
    const picker = screen.getByLabelText("Member Color for Ada");
    expect(picker).toHaveAttribute("type", "color");
    expect(picker).toHaveValue("#a9d8d2");
    expect(screen.queryByRole("option", { name: "teal" })).toBeNull();
    fireEvent.change(picker, { target: { value: "#4a90d9" } });
    expect(screen.getByLabelText("Member Color for Ada")).toHaveValue(
      "#4a90d9",
    );
  });

  test("duplicate Active Member Colors are blocked in the UI", async () => {
    await renderSettings();
    fireEvent.change(screen.getByLabelText("Member Color for Ben"), {
      target: { value: "#a9d8d2" },
    });
    expect(
      screen.getByText("Each Active Member needs a different Member Color."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Member Color for Ben")).toHaveValue(
      "#f6c9c5",
    );
  });

  test("Add member is disabled at six Active Members", async () => {
    const six = Object.values(LEGACY_TONE_COLORS).map((color, i) => ({
      id: `m${i}`,
      name: `P${i}`,
      status: "active" as const,
      color,
    }));
    expect(six.length).toBe(MAX_ACTIVE_MEMBERS);
    installFetch(publicSettings(six));
    render(<SettingsScreen />);
    await screen.findByDisplayValue("P0");
    expect(screen.getByRole("button", { name: "Add member" })).toBeDisabled();
  });

  test("Retire is the only removal and retired rows stay visible", async () => {
    const user = userEvent.setup();
    await renderSettings();
    expect(screen.getByDisplayValue("Cara")).toBeDisabled();
    expect(screen.getByText("Retired")).toBeInTheDocument();
    expect(screen.queryByLabelText("Member Color for Cara")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Retire" })[0]);
    expect(screen.getByDisplayValue("Ada")).toBeDisabled();
    expect(screen.queryByLabelText("Member Color for Ada")).toBeNull();
    expect(screen.getAllByText("Retired")).toHaveLength(2);
  });

  test("email is not part of the Member Color Settings copy", async () => {
    await renderSettings();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/email/i)).toBeNull();
    expect(screen.getByText(/Member Color \(#rrggbb\)/i)).toBeInTheDocument();
  });

  test("stale roster saves reject and reload through versioning", async () => {
    const user = userEvent.setup();
    const settings = publicSettings([ada]);
    installFetch(settings, {
      patch: () =>
        json(
          { ...settings, familyName: "OtherDisplay", configVersion: 2 },
          409,
        ),
    });
    render(<SettingsScreen />);
    const name = await screen.findByDisplayValue("Test");
    await user.clear(name);
    await user.type(name, "Nope");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("OtherDisplay")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        "Settings changed on another Display. Reloaded the current values — review and save again.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Settings pairing code", () => {
  test("a generated code appears as a QR and typed secret in a dialog, not inline", async () => {
    const user = userEvent.setup();
    await renderSettings();

    expect(screen.queryByRole("dialog", { name: "Pair Display" })).toBeNull();
    expect(screen.queryByText("ABC234")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Generate pairing code" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Pair Display" });
    expect(dialog).toHaveTextContent("ABC234");
    expect(
      screen.getByRole("img", { name: "Pairing QR code" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/scan|QR/i, { selector: "p, span, div" }),
    ).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Pair Display" })).toBeNull();
    expect(screen.queryByText("ABC234")).toBeNull();
  });
});

describe("Settings server update", () => {
  test("Update starts a Household server update", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(publicSettings([ada]));
    render(<SettingsScreen />);
    await screen.findByDisplayValue("Ada");

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      await screen.findByText(
        "Update started. This Display will go offline until the server is back.",
      ),
    ).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter((call) => {
      const url = urlOf(call[0]);
      const method = (call[1]?.method ?? "GET").toUpperCase();
      return method === "POST" && url.endsWith("/api/settings/update");
    });
    expect(posts).toHaveLength(1);
  });

  test("a failed update is reported without claiming it started", async () => {
    const user = userEvent.setup();
    const settings = publicSettings([ada]);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.endsWith("/api/settings")) {
          return json(settings);
        }
        if (method === "GET" && url.endsWith("/api/displays")) {
          return json({ displays: [], currentDisplayId: "d1" });
        }
        if (method === "POST" && url.endsWith("/api/settings/update")) {
          return json({ error: "Could not start update." }, 500);
        }
        return json({ error: `unhandled ${method} ${url}` }, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsScreen />);
    await screen.findByDisplayValue("Ada");

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(
      await screen.findByText("Could not start update."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Update started/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });
});

describe("Settings Idle Dim", () => {
  test("Display section offers Dim after and Dim to and Save persists them", async () => {
    const user = userEvent.setup();
    const settings = publicSettings([ada]);
    const fetchMock = installFetch(settings);
    render(<SettingsScreen />);

    const after = await screen.findByLabelText("Dim after");
    const to = screen.getByLabelText("Dim to");
    expect(after).toHaveValue("300000");
    expect(to).toHaveValue("10");

    await user.selectOptions(after, "120000");
    await user.selectOptions(to, "20");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter((call) => {
        const url = urlOf(call[0]);
        const method = (call[1]?.method ?? "GET").toUpperCase();
        return method === "PATCH" && url.endsWith("/api/settings");
      });
      expect(patches.length).toBeGreaterThan(0);
      const body = JSON.parse(String(patches[0][1]?.body ?? "{}")) as {
        idleDimAfterMs?: number;
        idleDimTo?: number;
      };
      expect(body.idleDimAfterMs).toBe(120_000);
      expect(body.idleDimTo).toBe(20);
    });
    expect(await screen.findByRole("button", { name: "Saved" })).toBeTruthy();
  });
});
