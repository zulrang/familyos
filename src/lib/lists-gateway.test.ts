/**
 * ListsGateway Fake half of the shared contract (#27).
 * Real adapter half: lists-gateway.contract.test.ts
 */

import { test } from "vitest";
import { createFakeListsGateway } from "./lists-fake.ts";
import { assertListsGatewayContract } from "./lists-gateway.contract.ts";

test("ListsGateway Fake satisfies contract", async () => {
  await assertListsGatewayContract(createFakeListsGateway());
});
