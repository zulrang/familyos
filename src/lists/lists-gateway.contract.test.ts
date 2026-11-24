// DESIGN-DEVIATION: see lists-gateway.recorded.ts.

import { test, vi } from "vitest";
import { assertListsGatewayContract } from "./lists-gateway.contract";
import { createRecordedTasksGfetch } from "./lists-gateway.recorded";

const recorded = vi.hoisted(() => {
  let gfetch: (url: string, init?: RequestInit) => Promise<Response> = () => {
    throw new Error("recorded gfetch not installed");
  };
  return {
    install(fn: typeof gfetch) {
      gfetch = fn;
    },
    gfetch: (url: string, init?: RequestInit) => gfetch(url, init),
  };
});

recorded.install(createRecordedTasksGfetch());

vi.mock("@/shared/google", () => ({
  ProviderAuthError: class ProviderAuthError extends Error {},
  gfetch: recorded.gfetch,
  throwIfGoogleFailed: async (response: Response) => {
    if (!response.ok)
      throw new Error(`Google request failed ${response.status}`);
  },
}));

test("ListsGateway Google adapter satisfies contract (recorded)", async () => {
  const { googleListsGateway } = await import("./lists-gateway.ts");
  await assertListsGatewayContract(googleListsGateway());
});
