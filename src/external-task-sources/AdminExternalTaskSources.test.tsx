// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AdminExternalTaskSources } from "./AdminExternalTaskSources";
import type { AdminTaskSource, AdminTaskSourcesRead } from "./admin-client";

const NO_TOKEN: AdminTaskSource["token"] = {
  source: null,
  ending: null,
  environmentSet: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function household(
  overrides: Partial<AdminTaskSourcesRead> = {},
): AdminTaskSourcesRead {
  return {
    members: [
      { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
      { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
      { id: "gran", name: "Gran", status: "retired" },
    ],
    defaultMember: null,
    timeZone: "America/New_York",
    version: 4,
    sources: [
      {
        id: "derupt",
        name: "Derupt",
        status: {
          state: "enabled",
          lastSuccessAt: "2026-11-15T17:00:00.000Z",
          lastProblem: {
            code: "unknown_member",
            at: "2026-11-15T16:00:00.000Z",
          },
        },
        token: { source: "saved", ending: "wxyz", environmentSet: false },
      },
    ],
    ...overrides,
  };
}

function derupt(
  status: AdminTaskSource["status"],
  token: AdminTaskSource["token"],
): Partial<AdminTaskSourcesRead> {
  return { sources: [{ id: "derupt", name: "Derupt", status, token }] };
}

function serve(initial: AdminTaskSourcesRead) {
  let current = initial;
  const saves: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/derupt-token")) {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      saves.push({ method: init.method, body });
      const token: AdminTaskSource["token"] =
        init.method === "PUT"
          ? {
              source: "saved",
              ending: body.token.slice(-4),
              environmentSet: false,
            }
          : NO_TOKEN;
      current = {
        ...current,
        sources: [
          { ...current.sources[0], status: { state: "starting" }, token },
        ],
      };
    } else if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      saves.push(body);
      current = {
        ...current,
        defaultMember: body.defaultMember,
        version: current.version + 1,
      };
    }
    return Response.json(current);
  });
  return saves;
}

test("chooses the default member from Active Members and saves it", async () => {
  const saves = serve(household());
  render(<AdminExternalTaskSources />);
  const select = await screen.findByRole("combobox", {
    name: "Default member",
  });
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["No default", "Dad", "Ellie"]);
  fireEvent.change(select, { target: { value: "dad" } });
  fireEvent.click(screen.getByRole("button", { name: "Save default member" }));
  expect(await screen.findByText("Default member saved.")).toBeVisible();
  expect(saves).toEqual([{ defaultMember: "dad", expectedVersion: 4 }]);
  expect(
    await screen.findByRole("combobox", { name: "Default member" }),
  ).toHaveValue("dad");
});

test("warns when the default member has retired", async () => {
  serve(household({ defaultMember: "gran" }));
  render(<AdminExternalTaskSources />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Gran is retired");
  expect(screen.getByRole("combobox", { name: "Default member" })).toHaveValue(
    "",
  );
});

test("shows each source's status and last problem code", async () => {
  serve(household());
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  expect(card).toHaveTextContent("On");
  expect(card).toHaveTextContent("Last successful check: Nov 15, 12:00");
  expect(card).toHaveTextContent("Last problem: unknown_member");
});

test("explains a halted source", async () => {
  serve(
    household({
      sources: [
        {
          id: "derupt",
          name: "Derupt",
          status: {
            state: "halted",
            reason: "token_rejected",
            at: "2026-11-15T17:00:00.000Z",
            lastSuccessAt: null,
            lastProblem: null,
          },
          token: { source: "saved", ending: "wxyz", environmentSet: false },
        },
      ],
    }),
  );
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  expect(card).toHaveTextContent("Stopped");
  expect(card).toHaveTextContent(
    "Derupt rejected the token. Save a new token to resume.",
  );
});

test("sets up Derupt by pasting a token, without mentioning .env.local", async () => {
  const saves = serve(
    household(
      derupt({ state: "disabled", reason: "not_configured" }, NO_TOKEN),
    ),
  );
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  expect(card).toHaveTextContent("Off");
  expect(card).toHaveTextContent("Not set up. Paste a connection token");
  expect(card).not.toHaveTextContent(".env.local");
  expect(card).not.toHaveTextContent("restart");
  expect(
    within(card).queryByRole("button", { name: "Clear token" }),
  ).toBeNull();
  const input = within(card).getByLabelText("Connection token");
  expect(input).toHaveAttribute("type", "password");
  fireEvent.change(input, {
    target: { value: "fake_pasted_token_000000001234" },
  });
  fireEvent.click(within(card).getByRole("button", { name: "Save token" }));
  expect(await screen.findByText("Derupt token saved.")).toBeVisible();
  expect(saves).toEqual([
    { method: "PUT", body: { token: "fake_pasted_token_000000001234" } },
  ]);
  const after = await screen.findByRole("article", { name: "Derupt status" });
  expect(after).toHaveTextContent("On");
  expect(after).toHaveTextContent(
    "Using the token saved here (ends in ••••1234).",
  );
  expect(after).not.toHaveTextContent("fake_pasted_token");
  expect(within(after).getByLabelText("New connection token")).toHaveValue("");
});

test("replaces a saved token", async () => {
  const saves = serve(household());
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  fireEvent.change(within(card).getByLabelText("New connection token"), {
    target: { value: "fake_replaced_token_00000005678" },
  });
  fireEvent.click(within(card).getByRole("button", { name: "Replace token" }));
  expect(await screen.findByText("Derupt token saved.")).toBeVisible();
  expect(saves).toEqual([
    { method: "PUT", body: { token: "fake_replaced_token_00000005678" } },
  ]);
});

test("clears a saved token after confirming", async () => {
  const saves = serve(household());
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  fireEvent.click(within(card).getByRole("button", { name: "Clear token" }));
  expect(card).toHaveTextContent("Tasks from Derupt stop arriving.");
  fireEvent.click(within(card).getByRole("button", { name: "Keep token" }));
  expect(saves).toEqual([]);
  fireEvent.click(within(card).getByRole("button", { name: "Clear token" }));
  fireEvent.click(within(card).getByRole("button", { name: "Clear token" }));
  expect(await screen.findByText("Derupt token cleared.")).toBeVisible();
  expect(saves).toEqual([{ method: "DELETE", body: undefined }]);
});

test("says when the token comes from the server environment", async () => {
  serve(
    household(
      derupt(
        { state: "enabled", lastSuccessAt: null, lastProblem: null },
        { source: "environment", ending: "envv", environmentSet: true },
      ),
    ),
  );
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  expect(card).toHaveTextContent(
    "Using FAMILYOS_DERUPT_TOKEN from the server (ends in ••••envv). A token saved here takes its place.",
  );
  // The variable can't be cleared from here; a saved token can override it.
  expect(
    within(card).queryByRole("button", { name: "Clear token" }),
  ).toBeNull();
  expect(
    within(card).getByRole("button", { name: "Save token" }),
  ).toBeDisabled();
});

test("says a saved token overrides the environment's, and what clearing does", async () => {
  serve(
    household(
      derupt(
        { state: "enabled", lastSuccessAt: null, lastProblem: null },
        { source: "saved", ending: "wxyz", environmentSet: true },
      ),
    ),
  );
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  expect(card).toHaveTextContent(
    "FAMILYOS_DERUPT_TOKEN is also set on the server; FamilyOS uses it if you clear this one.",
  );
  fireEvent.click(within(card).getByRole("button", { name: "Clear token" }));
  expect(card).toHaveTextContent(
    "Clear the saved token? FamilyOS goes back to FAMILYOS_DERUPT_TOKEN from the server.",
  );
});

test("shows a refused token's error", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("/derupt-token")
      ? Response.json(
          { error: "That doesn’t look like a Derupt connection token." },
          { status: 400 },
        )
      : Response.json(
          household(
            derupt({ state: "disabled", reason: "not_configured" }, NO_TOKEN),
          ),
        ),
  );
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  fireEvent.change(within(card).getByLabelText("Connection token"), {
    target: { value: "nope" },
  });
  fireEvent.click(within(card).getByRole("button", { name: "Save token" }));
  expect(await within(card).findByRole("alert")).toHaveTextContent(
    "doesn’t look like a Derupt connection token",
  );
});
