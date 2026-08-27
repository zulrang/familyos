/**
 * CalendarGateway Google adapter half of the shared contract (#40).
 * DESIGN-DEVIATION: see calendar-gateway.recorded.ts — hand-authored Calendar HTTP,
 * not live Google / captured cassettes.
 */

import { test, vi } from "vitest";
import { assertCalendarGatewayContract } from "./calendar-gateway.contract";
import { createRecordedCalendarGfetch } from "./calendar-gateway.recorded";

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

recorded.install(createRecordedCalendarGfetch());

vi.mock("@/shared/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/google")>();
  return { ...actual, gfetch: recorded.gfetch };
});

test("CalendarGateway Google adapter satisfies contract (recorded)", async () => {
  const { googleCalendarGateway } = await import("./calendar-gateway.ts");
  await assertCalendarGatewayContract(googleCalendarGateway());
});
