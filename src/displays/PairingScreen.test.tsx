// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PairingScreen } from "./PairingScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

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

describe("Pair Display", () => {
  test("manual code entry remains available and pairs with the typed secret", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(urlOf(input)).toMatch(/\/api\/pair$/);
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          code: "ABC234",
        });
        return json({ ok: true, displayId: "d1" });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, search: "", assign });

    render(<PairingScreen />);
    const field = screen.getByLabelText("Pairing code");
    await user.type(field, "abc234");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/");
    });
  });

  test("a scanned pairing URL completes pairing with the same secret", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          code: "K7MNPQ",
        });
        return json({ ok: true, displayId: "d2" });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      search: "?code=K7MNPQ",
      assign,
    });

    render(<PairingScreen />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.getByLabelText("Pairing code")).toHaveValue("K7MNPQ");
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/");
    });
  });

  test("expired scanned payloads fail with the same expiry copy as typed codes", async () => {
    const fetchMock = vi.fn(async () => json({ error: "expired" }, 403));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", {
      ...window.location,
      search: "?code=EXPIRE",
      assign: vi.fn(),
    });

    render(<PairingScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code has expired.",
    );
    expect(screen.getByLabelText("Pairing code")).toBeEnabled();
  });
});
