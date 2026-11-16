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
import type { AdminTaskSourcesRead } from "./admin-client";

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
      },
    ],
    ...overrides,
  };
}

/** A stateful stand-in for the admin endpoint that records saves. */
function serve(initial: AdminTaskSourcesRead) {
  let current = initial;
  const saves: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
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
        },
      ],
    }),
  );
  render(<AdminExternalTaskSources />);
  const card = await screen.findByRole("article", { name: "Derupt status" });
  expect(card).toHaveTextContent("Stopped");
  expect(card).toHaveTextContent("Derupt rejected the token");
});
