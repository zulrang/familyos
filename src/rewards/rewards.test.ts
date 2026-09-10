import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { tasksDatabase } from "@/tasks/store";
import { rewardsStore } from "./store";
import {
  parseRewardAdminCommand,
  parseRewardDraft,
  parseRewardsCommand,
  parseStarCost,
  type RewardsCommand,
} from "./types";

describe("Rewards persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "familyos-rewards-"));
    vi.stubEnv("FAMILYOS_DATA_DIR", dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  function fixture(cost = 3) {
    const db = tasksDatabase(),
      store = rewardsStore(db),
      id = crypto.randomUUID();
    const draft = parseRewardDraft({
      name: "New book",
      description: "Choose a book",
      cost,
      icon: "book-open",
    });
    if (!draft) throw Error("draft");
    store.administer({ kind: "create", id, draft });
    db.prepare("INSERT INTO star_adjustments VALUES (?,?,?,?,?)").run(
      crypto.randomUUID(),
      "a",
      10,
      "Helping",
      new Date().toISOString(),
    );
    const spend: Extract<RewardsCommand, { kind: "spend" }> = {
      kind: "spend",
      id: crypto.randomUUID(),
      member: "a",
      reward: id,
      revision: 1,
    };
    return { db, store, id, draft, spend };
  }
  test("positive safe costs have no five-star cap; invalid inputs are rejected", () => {
    for (const value of [
      0,
      -1,
      1.5,
      "3",
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(parseStarCost(value)).toBeNull();
    expect(parseStarCost(10)).toBe(10);
    expect(parseStarCost(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(
      parseRewardsCommand({
        kind: "spend",
        id: "bad",
        member: "a",
        reward: "bad",
        revision: 1,
      }),
    ).toBeNull();
    expect(
      parseRewardAdminCommand({
        kind: "create",
        id: crypto.randomUUID(),
        draft: { name: "", cost: 2, description: "", icon: "star" },
      }),
    ).toBeNull();
  });
  test("retrying a saved edit succeeds without advancing revision again", () => {
    const { store, id, draft } = fixture();
    const edit = {
      kind: "edit" as const,
      id,
      revision: 1,
      draft: { ...draft, name: "A new title" },
    };
    store.administer(edit);
    expect(() => store.administer(edit)).not.toThrow();
    expect(store.snapshot().rewards[0]).toMatchObject({
      name: "A new title",
      revision: 2,
    });
  });
  test("edit receipts survive later edits and retirement but reject a different stale payload", () => {
    const { store, db, id, draft } = fixture();
    const first = {
      kind: "edit" as const,
      id,
      revision: 1,
      draft: { ...draft, name: "First title" },
    };
    store.administer(first);
    store.administer({
      ...first,
      revision: 2,
      draft: { ...draft, name: "Later title" },
    });
    expect(() => rewardsStore(db).administer(first)).not.toThrow();
    expect(store.snapshot().rewards[0]).toMatchObject({
      name: "Later title",
      revision: 3,
    });
    expect(() => store.administer({ ...first, draft })).toThrow(
      /different edit/,
    );
    store.administer({ kind: "retire", id, revision: 3 });
    expect(() => store.administer(first)).not.toThrow();
    expect(store.snapshot().rewards[0]).toMatchObject({
      name: "Later title",
      revision: 4,
      retiredAt: expect.any(String),
    });
  });
  test("a failed edit receipt rolls back the edit and its revision", () => {
    const { store, db, id, draft } = fixture();
    const edit = {
      kind: "edit" as const,
      id,
      revision: 1,
      draft: { ...draft, name: "Changed title" },
    };
    db.exec(
      "CREATE TRIGGER fail_edit_receipt BEFORE INSERT ON reward_edits BEGIN SELECT RAISE(ABORT, 'receipt failure'); END;",
    );
    expect(() => store.administer(edit)).toThrow(/receipt failure/);
    expect(store.snapshot().rewards[0]).toMatchObject({
      name: draft.name,
      revision: 1,
    });
    db.exec("DROP TRIGGER fail_edit_receipt");
    store.administer(edit);
    expect(() => store.administer(edit)).not.toThrow();
    expect(store.snapshot().rewards[0].revision).toBe(2);
  });
  test("goals reserve nothing, follow current prices, and clear when a reward retires", () => {
    const { store, id, draft } = fixture();
    store.apply({ kind: "goal", member: "a", reward: id });
    expect(store.snapshot().balances).toEqual([{ member: "a", balance: 10 }]);
    const cost = parseStarCost(12);
    if (!cost) throw Error("cost");
    store.administer({
      kind: "edit",
      id,
      revision: 1,
      draft: { ...draft, cost },
    });
    expect(store.snapshot().rewards[0].cost).toBe(12);
    expect(store.snapshot().goals).toEqual([{ member: "a", reward: id }]);
    store.administer({ kind: "retire", id, revision: 2 });
    expect(store.snapshot().goals).toEqual([]);
    expect(() =>
      store.apply({ kind: "goal", member: "a", reward: id }),
    ).toThrow(/retired/);
    expect(() =>
      store.administer({ kind: "edit", id, revision: 2, draft }),
    ).toThrow(/retired/);
  });
  test("Spend and repeat after retirement retain original name and cost and deduct once", () => {
    const { store, id, draft, spend } = fixture();
    const first = store.apply(spend);
    store.administer({
      kind: "edit",
      id,
      revision: 1,
      draft: { ...draft, name: "Different book" },
    });
    store.administer({ kind: "retire", id, revision: 2 });
    expect(store.apply(spend)).toEqual(first);
    expect(first).toMatchObject({ name: "New book", cost: 3 });
    expect(store.snapshot().balances).toEqual([{ member: "a", balance: 7 }]);
    expect(() => store.apply({ ...spend, member: "b" })).toThrow(
      /already spent/,
    );
  });
  test("stale price, overdraw and second competing Spend leave balance intact", () => {
    const { store, id, draft, spend } = fixture(7);
    store.administer({ kind: "edit", id, revision: 1, draft });
    expect(() => store.apply(spend)).toThrow(/changed/);
    store.apply({ ...spend, revision: 2 });
    expect(() =>
      store.apply({ ...spend, id: crypto.randomUUID(), revision: 2 }),
    ).toThrow(/Not enough/);
    expect(store.snapshot().balances).toEqual([{ member: "a", balance: 3 }]);
  });
  test("failure saving receipt rolls back the star deduction and permits a safe retry", () => {
    const { store, db, spend } = fixture();
    db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON reward_spends BEGIN SELECT RAISE(ABORT, 'disk simulation'); END;",
    );
    expect(() => store.apply(spend)).toThrow(/disk simulation/);
    expect(store.snapshot().balances).toEqual([{ member: "a", balance: 10 }]);
    expect(
      db.prepare("SELECT id FROM star_adjustments WHERE id=?").get(spend.id),
    ).toBeUndefined();
    db.exec("DROP TRIGGER fail_receipt");
    store.apply(spend);
    expect(store.snapshot().balances).toEqual([{ member: "a", balance: 7 }]);
  });
  test("request IDs cannot collide with manual Grants, and receipts cannot be rewritten", () => {
    const { store, db, spend } = fixture();
    const existing = db
      .prepare("SELECT id FROM star_adjustments LIMIT 1")
      .get();
    expect(() => store.apply({ ...spend, id: String(existing?.id) })).toThrow(
      /already used/,
    );
    store.apply(spend);
    expect(() => db.exec("DELETE FROM reward_spends")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE reward_spends SET cost=1")).toThrow(
      /immutable/,
    );
  });
  test("a fresh store sees saved goals, rewards and balances", () => {
    const { store, db, id, spend } = fixture();
    store.apply({ kind: "goal", member: "a", reward: id });
    store.apply(spend);
    expect(rewardsStore(db).snapshot()).toEqual(store.snapshot());
  });
});
