/**
 * ListsGateway Fake half of the shared contract (#27).
 * Real adapter half: lists-gateway.contract.test.ts
 */

import { test } from "vitest";
import { createFakeListsGateway } from "./lists-fake";
import { assertListsGatewayContract } from "./lists-gateway.contract";

test("ListsGateway Fake satisfies contract", async () => {
  await assertListsGatewayContract(createFakeListsGateway());
});
