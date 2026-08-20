import assert from "node:assert/strict";
import type { ListsGateway } from "./lists-gateway.ts";

/**
 * Shared ListsGateway contract: Fake (unit lane) and Google adapter
 * (contract lane / recorded Tasks HTTP) must both pass.
 */
export async function assertListsGatewayContract(
  gateway: ListsGateway,
): Promise<void> {
  const alpha = await gateway.createList("Alpha");
  const beta = await gateway.createList("Beta");
  assert.equal(alpha.title, "Alpha");
  assert.equal(alpha.items.length, 0);
  assert.ok(alpha.id);
  assert.ok(beta.id);
  assert.notEqual(alpha.id, beta.id);

  const selected = await gateway.listSelected([
    beta.id,
    "tl-does-not-exist",
    alpha.id,
  ]);
  assert.deepEqual(
    selected.map((l) => l.id),
    [beta.id, alpha.id],
  );
  assert.equal(selected[0]?.title, "Beta");
  assert.equal(selected[1]?.title, "Alpha");

  const renamed = await gateway.renameList(alpha.id, "Alpha Renamed");
  assert.deepEqual(renamed, { id: alpha.id, title: "Alpha Renamed" });
  const afterRename = await gateway.listSelected([alpha.id]);
  assert.equal(afterRename[0]?.title, "Alpha Renamed");

  const milk = await gateway.addItem(alpha.id, "Milk");
  assert.equal(milk.title, "Milk");
  assert.equal(milk.done, false);
  assert.ok(milk.id);

  const withMilk = await gateway.listSelected([alpha.id]);
  assert.equal(withMilk[0]?.items[0]?.id, milk.id);

  const checked = await gateway.patchItem(alpha.id, milk.id, { done: true });
  assert.equal(checked.done, true);

  const retitled = await gateway.patchItem(alpha.id, milk.id, {
    title: "Oat milk",
  });
  assert.equal(retitled.title, "Oat milk");
  assert.equal(retitled.done, true);

  await gateway.clearCompleted(alpha.id);
  const cleared = await gateway.listSelected([alpha.id]);
  assert.equal(
    cleared[0]?.items.some((i) => i.id === milk.id),
    false,
  );

  const bread = await gateway.addItem(alpha.id, "Bread");
  await gateway.deleteItem(alpha.id, bread.id);
  const afterDelete = await gateway.listSelected([alpha.id]);
  assert.equal(
    afterDelete[0]?.items.some((i) => i.id === bread.id),
    false,
  );
}
