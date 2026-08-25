import assert from "node:assert/strict";
import { ListItemConflictError } from "./lists-error";
import type { ListsGateway } from "./lists-gateway";

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
  assert.ok(milk.expectedVersion);

  const withMilk = await gateway.listSelected([alpha.id]);
  assert.equal(withMilk[0]?.items[0]?.id, milk.id);
  assert.equal(withMilk[0]?.items[0]?.expectedVersion, milk.expectedVersion);

  const eggs = await gateway.addItem(alpha.id, "Eggs");
  const staleEggs = eggs.expectedVersion;
  const checkedEggs = await gateway.patchItem(
    alpha.id,
    eggs.id,
    { done: true },
    eggs.expectedVersion,
  );
  assert.equal(checkedEggs.done, true);
  assert.notEqual(checkedEggs.expectedVersion, staleEggs);

  await assert.rejects(
    () => gateway.patchItem(alpha.id, eggs.id, { title: "stolen" }, staleEggs),
    (e: unknown) => {
      assert.equal(e instanceof ListItemConflictError, true);
      const conflict = e as ListItemConflictError;
      assert.equal(conflict.item?.id, eggs.id);
      assert.equal(conflict.item?.title, "Eggs");
      assert.equal(conflict.item?.done, true);
      return true;
    },
  );
  const afterStaleEdit = await gateway.listSelected([alpha.id]);
  const eggsAfterEdit = afterStaleEdit[0]?.items.find((i) => i.id === eggs.id);
  assert.equal(eggsAfterEdit?.title, "Eggs");
  assert.equal(eggsAfterEdit?.done, true);

  await assert.rejects(
    () => gateway.patchItem(alpha.id, eggs.id, { done: false }, staleEggs),
    ListItemConflictError,
  );
  assert.equal(
    (await gateway.listSelected([alpha.id]))[0]?.items.find(
      (i) => i.id === eggs.id,
    )?.done,
    true,
  );

  const uncheckedEggs = await gateway.patchItem(
    alpha.id,
    eggs.id,
    { done: false },
    checkedEggs.expectedVersion,
  );
  assert.equal(uncheckedEggs.done, false);

  await assert.rejects(
    () => gateway.deleteItem(alpha.id, eggs.id, staleEggs),
    (e: unknown) => {
      assert.equal(e instanceof ListItemConflictError, true);
      assert.equal((e as ListItemConflictError).item?.id, eggs.id);
      return true;
    },
  );
  assert.equal(
    (await gateway.listSelected([alpha.id]))[0]?.items.some(
      (i) => i.id === eggs.id,
    ),
    true,
  );
  await gateway.deleteItem(alpha.id, eggs.id, uncheckedEggs.expectedVersion);
  assert.equal(
    (await gateway.listSelected([alpha.id]))[0]?.items.some(
      (i) => i.id === eggs.id,
    ),
    false,
  );

  const checked = await gateway.patchItem(
    alpha.id,
    milk.id,
    { done: true },
    milk.expectedVersion,
  );
  assert.equal(checked.done, true);
  assert.notEqual(checked.expectedVersion, milk.expectedVersion);

  const retitled = await gateway.patchItem(
    alpha.id,
    milk.id,
    { title: "Oat milk" },
    checked.expectedVersion,
  );
  assert.equal(retitled.title, "Oat milk");
  assert.equal(retitled.done, true);
  assert.notEqual(retitled.expectedVersion, checked.expectedVersion);

  await gateway.clearCompleted(alpha.id);
  const cleared = await gateway.listSelected([alpha.id]);
  assert.equal(
    cleared[0]?.items.some((i) => i.id === milk.id),
    false,
  );

  const bread = await gateway.addItem(alpha.id, "Bread");
  await gateway.deleteItem(alpha.id, bread.id, bread.expectedVersion);
  const afterDelete = await gateway.listSelected([alpha.id]);
  assert.equal(
    afterDelete[0]?.items.some((i) => i.id === bread.id),
    false,
  );
}
