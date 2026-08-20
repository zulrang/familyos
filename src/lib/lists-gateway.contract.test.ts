/**
 * ListsGateway Google adapter half of the shared contract (#27).
 * DESIGN-DEVIATION: see lists-gateway.recorded.ts — hand-authored Tasks HTTP,
 * not live Google / captured cassettes.
 */

import { test, vi } from "vitest";
import { assertListsGatewayContract } from "./lists-gateway.contract.ts";
import { createRecordedTasksGfetch } from "./lists-gateway.recorded.ts";

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

vi.mock("./google.ts", () => ({
  AuthError: class AuthError extends Error {},
  gfetch: recorded.gfetch,
}));

test("ListsGateway Google adapter satisfies contract (recorded)", async () => {
  const { googleListsGateway } = await import("./lists-gateway.ts");
  await assertListsGatewayContract(googleListsGateway());
});
