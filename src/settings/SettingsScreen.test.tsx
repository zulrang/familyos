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
