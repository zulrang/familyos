import { test } from "vitest";
import { createFakeCalendarGateway } from "./calendar-fake";
import { assertCalendarGatewayContract } from "./calendar-gateway.contract";

test("CalendarGateway Fake satisfies contract", async () => {
  await assertCalendarGatewayContract(createFakeCalendarGateway());
});
