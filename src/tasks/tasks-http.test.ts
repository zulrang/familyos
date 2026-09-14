import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  addLocalDays,
  type BountyDefinition,
  type EventReceipt,
  type LegacyTaskDefinition,
  type TasksViewRead,
} from "./types";

describe("Tasks HTTP", () => {
  let dataRoot: string;
  let handleGetTasks: typeof import("./tasks-http.ts").handleGetTasks;
  let handleCreateTask: typeof import("./tasks-http.ts").handleCreateTask;
  let handleSaveTask: typeof import("./tasks-http.ts").handleSaveTask;
  let handlePostTaskEvents: typeof import("./tasks-http.ts").handlePostTaskEvents;
  let handleBountyCommand: typeof import("./tasks-http.ts").handleBountyCommand;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;
  let cookieHeader: string;
  let loadDefinitions: typeof import("./store.ts").loadDefinitions;
  let loadEvents: typeof import("./store.ts").loadEvents;
  let tasksDatabase: typeof import("./store.ts").tasksDatabase;
  let closeTasksDatabase: typeof import("./store.ts").closeTasksDatabase;
  let loadBountyClaims: typeof import("./bounty-store.ts").loadBountyClaims;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-tasks-http-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      handleGetTasks,
      handleCreateTask,
      handleSaveTask,
      handlePostTaskEvents,
      handleBountyCommand,
    } = await import("./tasks-http.ts"));
    ({ writeHousehold } = await import("@/settings/settings"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE } = await import(
      "@/shared/pairing"
    ));
    ({ handlePair } = await import("@/displays/pairing-http"));
    ({ loadDefinitions, loadEvents, tasksDatabase, closeTasksDatabase } =
      await import("./store.ts"));
    ({ loadBountyClaims } = await import("./bounty-store.ts"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "TasksHousehold",
      members: [
        { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 1,
    });

    function cookieFrom(res: Response): string | null {
      const raw = res.headers.getSetCookie?.() ?? [];
      if (raw.length) {
        const line = raw.find((c) => c.startsWith(`${DISPLAY_COOKIE}=`));
        return line?.split(";")[0] ?? null;
      }
      const single = res.headers.get("set-cookie");
      if (!single) return null;
      return single.split(";")[0] ?? null;
    }

    const startupCode = await emitStartupPairingCode();
    assert.ok(startupCode);
    const pairRes = await handlePair(
      new Request("http://familyos.test/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: startupCode }),
      }),
    );
    assert.equal(pairRes.status, 200);
    const cookie = cookieFrom(pairRes);
    assert.ok(cookie);
    cookieHeader = cookie;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function req(url: string, init?: RequestInit): Request {
    return new Request(url, {
      ...init,
      headers: {
        cookie: cookieHeader,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  test("GET returns a flat projection, per-member progress, and a timestamp", async () => {
    const res = await handleGetTasks(req("http://familyos.test/api/tasks"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as TasksViewRead;
    assert.ok(Array.isArray(body.occurrences));
    assert.ok(!("columns" in body));
    assert.deepEqual(
      body.progress.map((row) => row.member),
      ["dad", "ellie"],
    );
    for (const row of body.progress) {
      assert.equal(typeof row.done, "number");
      assert.equal(typeof row.total, "number");
    }
    assert.ok(typeof body.today === "string");
    assert.ok(typeof body.generatedAt === "string");
    assert.ok(!Number.isNaN(Date.parse(body.generatedAt)));
    assert.ok(Array.isArray(body.starBalances));
    assert.ok(Array.isArray(body.definitions));
  });

  test("create shows the same day; timed sorts before untimed", async () => {
    const untimed = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Walk dog",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    assert.equal(untimed.status, 200);
    const timed = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Brush teeth",
          type: "routine",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
          time: "07:00",
        }),
      }),
    );
    assert.equal(timed.status, 200);

    const res = await handleGetTasks(req("http://familyos.test/api/tasks"));
    const body = (await res.json()) as TasksViewRead;
    const dadRows = body.occurrences.filter((row) => row.assignee === "dad");
    assert.ok(dadRows.some((row) => row.title === "Walk dog"));
    assert.ok(dadRows.some((row) => row.title === "Brush teeth"));
    const titles = dadRows.map((row) => row.title);
    assert.ok(titles.indexOf("Brush teeth") < titles.indexOf("Walk dog"));
    assert.equal(
      dadRows.every((row) => row.window === body.today),
      true,
    );
    const dadProgress = body.progress.find((row) => row.member === "dad");
    assert.ok(dadProgress);
    assert.ok((dadProgress?.total ?? 0) >= 2);
    const ellieProgress = body.progress.find((row) => row.member === "ellie");
    assert.deepEqual(ellieProgress, { member: "ellie", done: 0, total: 0 });
  });

  test("create persists a weekly rotation with stars and defaults omitted stars to zero", async () => {
    const omitted = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Default stars",
          type: "chore",
          recurrence: { kind: "monthly", day: 28 },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    assert.equal(omitted.status, 200);
    const omittedBody = (await omitted.json()) as {
      definition: LegacyTaskDefinition;
    };
    assert.equal(omittedBody.definition.stars, 0);
    assert.equal(
      loadDefinitions().find(
        (definition) => definition.id === omittedBody.definition.id,
      )?.stars,
      0,
    );

    const explicit = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Earn stars",
          type: "routine",
          recurrence: { kind: "weekly", days: ["mon", "thu"] },
          assignment: { kind: "rotation", order: ["ellie", "dad"] },
          stars: 7,
        }),
      }),
    );
    assert.equal(explicit.status, 200);
    const explicitBody = (await explicit.json()) as {
      definition: LegacyTaskDefinition;
    };
    const persisted = loadDefinitions().find(
      (definition) => definition.id === explicitBody.definition.id,
    );
    assert.deepEqual(persisted?.recurrence, {
      kind: "weekly",
      days: ["mon", "thu"],
    });
    assert.deepEqual(persisted?.assignment, {
      kind: "rotation",
      order: ["ellie", "dad"],
    });
    assert.equal(persisted?.stars, 7);
  });

  test("create rejects malformed and unsafe star values without breaking reads", async () => {
    for (const stars of [-1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
      const before = loadDefinitions().length;
      const response = await handleCreateTask(
        req("http://familyos.test/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: "Invalid stars",
            type: "chore",
            recurrence: { kind: "daily" },
            assignment: { kind: "fixed", member: "dad" },
            stars,
          }),
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(loadDefinitions().length, before);
    }
    assert.equal(
      (await handleGetTasks(req("http://familyos.test/api/tasks"))).status,
      200,
    );
  });

  test("GET exposes stored star balances after a completion and adjustment", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Star task",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
          stars: 5,
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: definition.id,
              window: before.today,
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
          ],
        }),
      }),
    );
    tasksDatabase()
      .prepare(
        `INSERT INTO star_adjustments (id, member, delta, reason, at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), "dad", -2, "Reward", "2026-08-25T17:00:00Z");
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.deepEqual(
      after.starBalances.find((balance) => balance.member === "dad"),
      { member: "dad", balance: 3 },
    );
  });

  test("a starred monthly open task projects through claim and completion", async () => {
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Wash bedding",
          type: "chore",
          recurrence: { kind: "monthly", day: 15 },
          assignment: { kind: "open" },
          stars: 7,
        }),
      }),
    );
    assert.equal(created.status, 200);
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    assert.deepEqual(definition.recurrence, { kind: "monthly", day: 15 });
    assert.deepEqual(definition.assignment, { kind: "open" });
    assert.equal(definition.stars, 7);

    const unclaimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const open = unclaimed.occurrences.find(
      (row) => row.task === definition.id,
    );
    assert.equal(open?.state, "pending");
    assert.equal(open?.assignee, null);
    assert.deepEqual(unclaimed.progress, before.progress);
    assert.ok(open);

    const firstClaim = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "claimed",
              task: definition.id,
              window: open.window,
              by: "dad",
            },
          ],
        }),
      }),
    );
    const firstReceipt = (await firstClaim.json()) as {
      receipts: EventReceipt[];
    };
    assert.equal(firstReceipt.receipts[0]?.status, "inserted");

    const secondClaim = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "claimed",
              task: definition.id,
              window: open.window,
              by: "ellie",
            },
          ],
        }),
      }),
    );
    const secondReceipt = (await secondClaim.json()) as {
      receipts: EventReceipt[];
    };
    assert.equal(secondReceipt.receipts[0]?.status, "already-present");

    const claimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const claimedRow = claimed.occurrences.find(
      (row) => row.task === definition.id,
    );
    assert.equal(claimedRow?.state, "claimed");
    assert.equal(claimedRow?.assignee, "dad");
    const dadBefore = before.progress.find((row) => row.member === "dad");
    const dadClaimed = claimed.progress.find((row) => row.member === "dad");
    assert.equal(dadClaimed?.total, (dadBefore?.total ?? 0) + 1);

    await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: definition.id,
              window: open.window,
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
          ],
        }),
      }),
    );
    const completed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const completedRow = completed.occurrences.find(
      (row) => row.task === definition.id,
    );
    assert.equal(completedRow?.state, "done");
    if (completedRow?.state === "done") assert.equal(completedRow.by, "dad");
    const dadCompleted = completed.progress.find((row) => row.member === "dad");
    assert.equal(dadCompleted?.done, (dadBefore?.done ?? 0) + 1);
    const balanceBefore =
      before.starBalances.find((row) => row.member === "dad")?.balance ?? 0;
    assert.deepEqual(
      completed.starBalances.find((row) => row.member === "dad"),
      { member: "dad", balance: balanceBefore + 7 },
    );
  });

  test("completion increments progress; a duplicate stores one fact", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Trash",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "ellie" },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const occ = before.occurrences.find((row) => row.task === definition.id);
    assert.ok(occ);
    assert.equal(occ?.state, "pending");

    const event = {
      kind: "completed",
      task: definition.id,
      window: before.today,
      by: "ellie",
      at: "2026-08-25T16:00:00Z",
    };
    const first = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({ events: [event] }),
      }),
    );
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { receipts: EventReceipt[] };
    assert.equal(firstBody.receipts[0]?.status, "inserted");

    const second = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({ events: [event] }),
      }),
    );
    assert.equal(second.status, 200);
    const secondBody = (await second.json()) as { receipts: EventReceipt[] };
    assert.equal(secondBody.receipts[0]?.status, "already-present");

    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const done = after.occurrences.find((row) => row.task === definition.id);
    assert.equal(done?.state, "done");
    const ellie = after.progress.find((row) => row.member === "ellie");
    const beforeEllie = before.progress.find((row) => row.member === "ellie");
    assert.equal(ellie?.done, (beforeEllie?.done ?? 0) + 1);
    assert.equal(
      loadEvents().filter(
        (row) =>
          row.task === definition.id &&
          row.window === before.today &&
          row.kind === "completed",
      ).length,
      1,
    );
  });

  test("a closed-window completion advances an active-member rotation", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Dishes rotation",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "rotation", order: ["dad", "ellie"] },
        }),
      }),
    );
    assert.equal(created.status, 200);
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const closedWindow = addLocalDays(before.today, -1);
    const completed = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: definition.id,
              window: closedWindow,
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
          ],
        }),
      }),
    );
    assert.equal(completed.status, 200);
    const completedBody = (await completed.json()) as {
      receipts: EventReceipt[];
    };
    assert.equal(completedBody.receipts[0]?.status, "inserted");

    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const row = after.occurrences.find(
      (occurrence) => occurrence.task === definition.id,
    );
    assert.equal(row?.window, after.today);
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, "ellie");
    assert.equal(
      after.occurrences.some(
        (occurrence) =>
          occurrence.task === definition.id &&
          occurrence.window === closedWindow,
      ),
      false,
    );
  });

  test("a skip with no reason is a skipped occurrence", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Skip me",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const skipped = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "skipped",
              task: definition.id,
              window: before.today,
            },
          ],
        }),
      }),
    );
    assert.equal(skipped.status, 200);
    const skippedBody = (await skipped.json()) as { receipts: EventReceipt[] };
    assert.equal(skippedBody.receipts[0]?.status, "inserted");
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const row = after.occurrences.find((occ) => occ.task === definition.id);
    assert.equal(row?.state, "skipped");
    if (row?.state === "skipped") assert.equal(row.reason, null);
  });

  test("a skip with a preset reason keeps that reason", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Away skip",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "ellie" },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const skipped = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "skipped",
              task: definition.id,
              window: before.today,
              reason: "Away",
            },
          ],
        }),
      }),
    );
    assert.equal(skipped.status, 200);
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const row = after.occurrences.find((occ) => occ.task === definition.id);
    assert.equal(row?.state, "skipped");
    if (row?.state === "skipped") assert.equal(row.reason, "Away");
  });

  test("an empty skip reason is stored as no reason", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Empty reason skip",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const skipped = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "skipped",
              task: definition.id,
              window: before.today,
              reason: "   ",
            },
          ],
        }),
      }),
    );
    assert.equal(skipped.status, 200);
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const row = after.occurrences.find((occ) => occ.task === definition.id);
    assert.equal(row?.state, "skipped");
    if (row?.state === "skipped") assert.equal(row.reason, null);
  });

  test("a skip does not change the next window's rotation assignee", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Skip rotation",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "rotation", order: ["dad", "ellie"] },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(
      before.occurrences.find((occ) => occ.task === definition.id)?.assignee,
      "dad",
    );
    const skipped = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "skipped",
              task: definition.id,
              window: addLocalDays(before.today, -1),
              reason: "Sick",
            },
          ],
        }),
      }),
    );
    assert.equal(skipped.status, 200);
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const row = after.occurrences.find((occ) => occ.task === definition.id);
    assert.equal(row?.window, after.today);
    assert.equal(row?.state, "pending");
    assert.equal(row?.assignee, "dad");
  });

  test("rotation creation requires a nonempty active-member order", async () => {
    const empty = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Empty rotation",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "rotation", order: [] },
        }),
      }),
    );
    assert.equal(empty.status, 400);

    const inactive = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Bad rotation",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "rotation", order: ["dad", "ghost"] },
        }),
      }),
    );
    assert.equal(inactive.status, 400);
  });

  test("a malformed batch rejects before any write", async () => {
    const before = loadEvents().length;
    const res = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: "ghost",
              window: "2026-08-25",
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
            { kind: "not-an-event" },
          ],
        }),
      }),
    );
    assert.equal(res.status, 400);
    assert.equal(loadEvents().length, before);
  });

  test("a verified trigger failure rejects that event and applies siblings", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Laundry",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const view = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const res = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "verified",
              task: definition.id,
              window: view.today,
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
            {
              kind: "completed",
              task: definition.id,
              window: view.today,
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
          ],
        }),
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { receipts: EventReceipt[] };
    assert.equal(body.receipts[0]?.status, "rejected");
    assert.equal(body.receipts[1]?.status, "inserted");
  });

  test("pairing is required", async () => {
    const res = await handleGetTasks(
      new Request("http://familyos.test/api/tasks"),
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "pairing required");
  });

  test("create persists each recurrence kind with fixed assignment and zero stars", async () => {
    const recurrences = [
      { kind: "once", date: "2026-09-01" },
      { kind: "daily" },
      { kind: "weekly", days: ["mon", "thu"] },
      { kind: "monthly", day: 28 },
    ];
    for (const recurrence of recurrences) {
      const response = await handleCreateTask(
        req("http://familyos.test/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: `${recurrence.kind} task`,
            type: "chore",
            recurrence,
            assignment: { kind: "fixed", member: "dad" },
          }),
        }),
      );
      assert.equal(response.status, 200);
      const { definition } = (await response.json()) as {
        definition: LegacyTaskDefinition;
      };
      assert.deepEqual(definition.recurrence, recurrence);
      assert.deepEqual(definition.assignment, {
        kind: "fixed",
        member: "dad",
      });
      assert.equal(definition.stars, 0);
    }
  });

  test("create rejects invalid monthly days and an empty weekly schedule", async () => {
    for (const recurrence of [
      { kind: "monthly", day: 29 },
      { kind: "monthly", day: 30 },
      { kind: "monthly", day: 31 },
      { kind: "weekly", days: [] },
    ]) {
      const response = await handleCreateTask(
        req("http://familyos.test/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: "Nope",
            type: "chore",
            recurrence,
            assignment: { kind: "fixed", member: "dad" },
          }),
        }),
      );
      assert.equal(response.status, 400);
    }
  });

  test("create rejects retired members", async () => {
    const missing = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Nope",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "ghost" },
        }),
      }),
    );
    assert.equal(missing.status, 400);
  });

  test("public create/save reject new open Routines but preserve legacy metadata edits", async () => {
    const createOpenRoutine = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Nope",
          type: "routine",
          recurrence: { kind: "daily" },
          assignment: { kind: "open" },
        }),
      }),
    );
    assert.equal(createOpenRoutine.status, 400);

    const legacyId = crypto.randomUUID();
    tasksDatabase()
      .prepare(
        `INSERT INTO definitions
          (id, lineage, title, type, recurrence, assignment, time, stars, retired_at)
         VALUES (?, ?, 'Morning check', 'routine', '{"kind":"daily"}',
                 '{"kind":"open"}', NULL, 0, NULL)`,
      )
      .run(legacyId, crypto.randomUUID());
    const metadata = {
      id: legacyId,
      title: "Morning checklist",
      type: "routine",
      recurrence: { kind: "daily" },
      assignment: { kind: "open" },
      time: "08:00",
      stars: 1,
    };
    assert.equal(
      (
        await handleSaveTask(
          req("http://familyos.test/api/tasks", {
            method: "PUT",
            body: JSON.stringify(metadata),
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await handleSaveTask(
          req("http://familyos.test/api/tasks", {
            method: "PUT",
            body: JSON.stringify({
              ...metadata,
              recurrence: { kind: "weekly", days: ["mon"] },
            }),
          }),
        )
      ).status,
      400,
    );

    const assigned = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Assigned",
          type: "routine",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    const { definition } = (await assigned.json()) as {
      definition: LegacyTaskDefinition;
    };
    assert.equal(
      (
        await handleSaveTask(
          req("http://familyos.test/api/tasks", {
            method: "PUT",
            body: JSON.stringify({
              id: definition.id,
              title: definition.title,
              type: "routine",
              recurrence: definition.recurrence,
              assignment: { kind: "open" },
              stars: 0,
            }),
          }),
        )
      ).status,
      400,
    );
  });

  test("PUT overwrites details in place and keeps the same id", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Dishes",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
          stars: 2,
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const saved = await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: definition.id,
          title: "Trash",
          type: "routine",
          recurrence: definition.recurrence,
          assignment: definition.assignment,
          time: "07:00",
          stars: 5,
        }),
      }),
    );
    assert.equal(saved.status, 200);
    const body = (await saved.json()) as {
      definition: LegacyTaskDefinition;
    };
    assert.equal(body.definition.id, definition.id);
    assert.equal(body.definition.lineage, definition.lineage);
    assert.equal(body.definition.retiredAt, null);
    assert.equal(body.definition.title, "Trash");
    const viewAfter = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(
      viewAfter.occurrences.find((row) => row.task === definition.id)?.title,
      "Trash",
    );
    assert.equal(
      viewAfter.definitions.find((row) => row.id === definition.id)?.stars,
      5,
    );
  });

  test("PUT that changes assignment retires the old row and carries the new title", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Dishes",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const saved = await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: definition.id,
          title: "Kitchen",
          type: definition.type,
          recurrence: definition.recurrence,
          assignment: { kind: "fixed", member: "ellie" },
          stars: 0,
        }),
      }),
    );
    assert.equal(saved.status, 200);
    const body = (await saved.json()) as {
      definition: LegacyTaskDefinition;
    };
    assert.notEqual(body.definition.id, definition.id);
    assert.equal(body.definition.lineage, definition.lineage);
    assert.equal(body.definition.title, "Kitchen");
    assert.equal(
      loadDefinitions().find((row) => row.id === definition.id)?.title,
      "Dishes",
    );
    assert.equal(
      loadDefinitions().find((row) => row.id === definition.id)?.retiredAt !==
        null,
      true,
    );
    const viewAfter = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(
      viewAfter.definitions.some((row) => row.id === definition.id),
      false,
    );
    assert.equal(
      viewAfter.occurrences.find((row) => row.task === body.definition.id)
        ?.title,
      "Kitchen",
    );
  });

  test("PUT pre-rotates a rotation so the person on turn stays on turn", async () => {
    await writeHousehold({
      familyName: "TasksHousehold",
      members: [
        { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
        { id: "luke", name: "Luke", status: "active", color: "#dccfea" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 1,
    });
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Dishes rotation",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "rotation", order: ["dad", "ellie", "luke"] },
        }),
      }),
    );
    const { definition } = (await created.json()) as {
      definition: LegacyTaskDefinition;
    };
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: definition.id,
              window: addLocalDays(before.today, -1),
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
          ],
        }),
      }),
    );
    const saved = await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: definition.id,
          title: definition.title,
          type: definition.type,
          recurrence: { kind: "weekly", days: ["mon"] },
          assignment: definition.assignment,
          stars: 0,
        }),
      }),
    );
    const body = (await saved.json()) as {
      definition: LegacyTaskDefinition;
    };
    assert.deepEqual(body.definition.assignment, {
      kind: "rotation",
      order: ["ellie", "luke", "dad"],
    });
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(
      after.occurrences.find((row) => row.task === body.definition.id)
        ?.assignee,
      "ellie",
    );
    await writeHousehold({
      familyName: "TasksHousehold",
      members: [
        { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 1,
    });
  });

  test("a completion after a title-only save still appears; a retired id does not", async () => {
    const titleOnly = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Live rename",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
        }),
      }),
    );
    const live = (await titleOnly.json()) as {
      definition: LegacyTaskDefinition;
    };
    await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: live.definition.id,
          title: "Renamed live",
          type: live.definition.type,
          recurrence: live.definition.recurrence,
          assignment: live.definition.assignment,
          stars: 0,
        }),
      }),
    );
    const replacedCreate = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Old dishes",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "ellie" },
        }),
      }),
    );
    const replaced = (await replacedCreate.json()) as {
      definition: LegacyTaskDefinition;
    };
    const retired = await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: replaced.definition.id,
          title: "New dishes",
          type: replaced.definition.type,
          recurrence: replaced.definition.recurrence,
          assignment: { kind: "open" },
          stars: 0,
        }),
      }),
    );
    const retiredBody = (await retired.json()) as {
      definition: LegacyTaskDefinition;
    };
    const today = (
      (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"))
      ).json()) as TasksViewRead
    ).today;
    await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "completed",
              task: live.definition.id,
              window: today,
              by: "dad",
              at: "2026-08-25T16:00:00Z",
            },
            {
              kind: "completed",
              task: replaced.definition.id,
              window: today,
              by: "ellie",
              at: "2026-08-25T16:00:00Z",
            },
          ],
        }),
      }),
    );
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(
      after.occurrences.find((row) => row.task === live.definition.id)?.state,
      "done",
    );
    assert.equal(
      after.occurrences.some((row) => row.task === replaced.definition.id),
      false,
    );
    assert.equal(
      after.occurrences.find((row) => row.task === retiredBody.definition.id)
        ?.state,
      "pending",
    );
  });

  test("PUT of an unknown id is not found", async () => {
    const res = await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          title: "Ghost",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
          stars: 0,
        }),
      }),
    );
    assert.equal(res.status, 404);
  });

  test("a Once Bounty is claimed and completed exactly once from its persistent snapshot", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "  Wash the car  ",
          stars: 0,
          recurrence: { kind: "once" },
        }),
      }),
    );
    assert.equal(created.status, 200);

    const available = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(available.availableBounties.length, 1);
    assert.equal(available.availableBounties[0]?.title, "Wash the car");
    assert.equal(available.availableBounties[0]?.stars, 0);
    assert.equal(
      available.progress.find((row) => row.member === "dad")?.total,
      available.occurrences.filter((row) => row.assignee === "dad").length,
    );
    const advertisedOffering = available.availableBounties[0];
    assert.ok(advertisedOffering);
    const offering = advertisedOffering.offering;

    closeTasksDatabase();
    const availableAfterRestart = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(
      availableAfterRestart.availableBounties.some(
        (row) => row.offering.definition === offering.definition,
      ),
      true,
    );

    const requestId = crypto.randomUUID();
    const revisionless = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering,
          member: "dad",
        }),
      }),
    );
    assert.equal(revisionless.status, 409);
    const claim = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId,
          offering,
          member: "dad",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    assert.equal(claim.status, 200);
    const claimBody = (await claim.json()) as {
      receipt: { result?: { claim?: { id: string } } };
    };
    assert.ok(claimBody.receipt.result?.claim?.id);

    const repeated = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId,
          offering,
          member: "dad",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    assert.equal((await repeated.json()).receipt.status, "already-applied");

    const reusedForDifferentClaim = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId,
          offering,
          member: "ellie",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    assert.equal(reusedForDifferentClaim.status, 409);

    const competing = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering,
          member: "ellie",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    assert.equal(competing.status, 409);

    const claimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(claimed.availableBounties.length, 0);
    assert.equal(claimed.bountyClaims[0]?.claim.member, "dad");
    assert.equal(claimed.bountyClaims[0]?.claim.scheduledOn, claimed.today);
    assert.equal(claimed.bountyClaims[0]?.claim.title, "Wash the car");
    assert.equal(claimed.bountyClaims[0]?.claim.stars, 0);
    assert.equal(
      claimed.progress.find((row) => row.member === "dad")?.total,
      claimed.occurrences.filter((row) => row.assignee === "dad").length + 1,
    );

    closeTasksDatabase();
    const nextDay = new Date(`${addLocalDays(claimed.today, 1)}T17:00:00Z`);
    const afterRestart = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), nextDay)
    ).json()) as TasksViewRead;
    assert.equal(afterRestart.availableBounties.length, 0);
    assert.equal(
      afterRestart.bountyClaims[0]?.claim.scheduledOn,
      claimed.today,
    );
    assert.equal(afterRestart.bountyClaims[0]?.state.kind, "unfinished");

    const claimId = claimed.bountyClaims[0]?.claim.id;
    assert.ok(claimId);
    const completeRequest = crypto.randomUUID();
    const completed = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "complete-bounty",
          requestId: completeRequest,
          claim: claimId,
          revision: 0,
        }),
      }),
    );
    assert.equal(completed.status, 200);
    const completionId = (await completed.json()).receipt.result.completion.id;
    assert.ok(completionId);
    const completionRetry = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "complete-bounty",
          requestId: completeRequest,
          claim: claimId,
          revision: 0,
        }),
      }),
    );
    assert.equal(
      (await completionRetry.json()).receipt.status,
      "already-applied",
    );

    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    assert.equal(after.availableBounties.length, 0);
    assert.equal(after.bountyClaims[0]?.state.kind, "completed");
    const completedClaim = after.bountyClaims[0];
    if (completedClaim?.state.kind === "completed") {
      assert.equal(completedClaim.state.completion.creditedStars, 0);
      assert.equal(
        Number.isNaN(Date.parse(completedClaim.state.completion.at)),
        false,
      );
    }
    assert.equal(
      tasksDatabase()
        .prepare(
          "SELECT COUNT(*) AS count FROM bounty_completions WHERE claim_id = ?",
        )
        .get(claimId)?.count,
      1,
    );
    const tomorrow = new Date(`${addLocalDays(after.today, 1)}T17:00:00Z`);
    const tomorrowView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), tomorrow)
    ).json()) as TasksViewRead;
    assert.equal(
      tomorrowView.bountyClaims.some(
        (row) => row.claim.offering.definition === offering.definition,
      ),
      false,
    );
    assert.equal(
      tomorrowView.availableBounties.some(
        (row) => row.offering.definition === offering.definition,
      ),
      false,
    );
    const tomorrowDad = tomorrowView.progress.find(
      (row) => row.member === "dad",
    );
    const tomorrowDadOccurrences = tomorrowView.occurrences.filter(
      (row) => row.assignee === "dad",
    );
    assert.equal(tomorrowDad?.total, tomorrowDadOccurrences.length);
    assert.equal(
      tomorrowDad?.done,
      tomorrowDadOccurrences.filter((row) => row.state === "done").length,
    );
  });

  test("release preserves the offering and snapshot while reclaim captures fresh terms", async () => {
    const firstDay = new Date("2026-09-13T16:00:00Z");
    const secondDay = new Date("2026-09-14T16:00:00Z");
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Clean windows",
          stars: 3,
          recurrence: { kind: "once" },
        }),
      }),
    );
    const definition = (await created.json()).definition as BountyDefinition;
    const advertised = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), firstDay)
    ).json()) as TasksViewRead;
    const firstOffering = advertised.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(firstOffering);

    await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering: firstOffering.offering,
          member: "dad",
          definitionRevision: firstOffering.definitionRevision,
        }),
      }),
      firstDay,
    );
    const claimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), firstDay)
    ).json()) as TasksViewRead;
    const firstClaim = claimed.bountyClaims.find(
      (row) => row.claim.offering.definition === definition.id,
    );
    assert.ok(firstClaim);

    const releaseRequest = crypto.randomUUID();
    const releaseCommand = {
      kind: "release-bounty",
      requestId: releaseRequest,
      claim: firstClaim.claim.id,
      revision: firstClaim.revision,
    };
    const released = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify(releaseCommand),
      }),
      firstDay,
    );
    assert.equal(released.status, 200);
    assert.deepEqual((await released.json()).receipt.result, {
      kind: "released",
      claim: {
        id: firstClaim.claim.id,
        offering: firstOffering.offering,
        member: "dad",
        scheduledOn: "2026-09-13",
        title: "Clean windows",
        stars: 3,
      },
      revision: 1,
    });

    closeTasksDatabase();
    const retry = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify(releaseCommand),
      }),
      firstDay,
    );
    assert.equal((await retry.json()).receipt.status, "already-applied");
    const releasedView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), firstDay)
    ).json()) as TasksViewRead;
    const reopened = releasedView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(reopened);
    assert.equal(reopened.id, firstOffering.id);
    assert.equal(
      releasedView.bountyClaims.some(
        (row) => row.claim.id === firstClaim.claim.id,
      ),
      false,
    );

    tasksDatabase()
      .prepare(
        "UPDATE bounty_definitions SET title = ?, stars = ?, revision = revision + 1 WHERE id = ?",
      )
      .run("Polish windows", 8, definition.id);
    const refreshedOffering = (
      (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"), secondDay)
      ).json()) as TasksViewRead
    ).availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(refreshedOffering);
    await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering: refreshedOffering.offering,
          member: "ellie",
          definitionRevision: refreshedOffering.definitionRevision,
        }),
      }),
      secondDay,
    );
    const reclaimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), secondDay)
    ).json()) as TasksViewRead;
    const replacement = reclaimed.bountyClaims.find(
      (row) => row.claim.offering.definition === definition.id,
    );
    assert.ok(replacement);
    assert.notEqual(replacement.claim.id, firstClaim.claim.id);
    assert.equal(replacement.claim.member, "ellie");
    assert.equal(replacement.claim.scheduledOn, "2026-09-14");
    assert.equal(replacement.claim.title, "Polish windows");
    assert.equal(replacement.claim.stars, 8);

    for (const kind of ["complete-bounty", "release-bounty"] as const) {
      const stale = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind,
            requestId: crypto.randomUUID(),
            claim: firstClaim.claim.id,
            revision: firstClaim.revision,
          }),
        }),
        secondDay,
      );
      assert.equal(stale.status, 409);
    }
    const ellieBefore =
      reclaimed.starBalances.find((row) => row.member === "ellie")?.balance ??
      0;
    const completedReplacement = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "complete-bounty",
          requestId: crypto.randomUUID(),
          claim: replacement.claim.id,
          revision: replacement.revision,
        }),
      }),
      secondDay,
    );
    assert.equal(completedReplacement.status, 200);
    const completedView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), secondDay)
    ).json()) as TasksViewRead;
    assert.equal(
      completedView.starBalances.find((row) => row.member === "ellie")?.balance,
      ellieBefore + 8,
    );
    const history = tasksDatabase()
      .prepare(
        "SELECT id, member, scheduled_on, title, stars, revision, state FROM bounty_claims WHERE offering_id = ? ORDER BY rowid",
      )
      .all(firstOffering.id)
      .map((row) => ({ ...row }));
    assert.deepEqual(history, [
      {
        id: firstClaim.claim.id,
        member: "dad",
        scheduled_on: "2026-09-13",
        title: "Clean windows",
        stars: 3,
        revision: 1,
        state: "released",
      },
      {
        id: replacement.claim.id,
        member: "ellie",
        scheduled_on: "2026-09-14",
        title: "Polish windows",
        stars: 8,
        revision: 1,
        state: "completed",
      },
    ]);
  });

  test("Bounty boundaries reject illegal definition shapes, ineligible members, and legacy events", async () => {
    const invalidBodies = [
      {
        kind: "bounty",
        title: "Dated",
        stars: 2,
        recurrence: { kind: "once", date: "2026-09-13" },
      },
      {
        kind: "bounty",
        title: "Assigned",
        stars: 2,
        recurrence: { kind: "once" },
        assignment: { kind: "fixed", member: "dad" },
      },
      {
        kind: "bounty",
        title: "Timed",
        stars: 2,
        recurrence: { kind: "once" },
        time: "08:00",
      },
      {
        kind: "bounty",
        title: "Routine",
        type: "routine",
        stars: 2,
        recurrence: { kind: "once" },
      },
      {
        kind: "bounty",
        title: "Fractional",
        stars: 1.5,
        recurrence: { kind: "once" },
      },
      {
        kind: "bounty",
        title: "No recurring start",
        stars: 2,
        recurrence: { kind: "recurring", cadence: { kind: "daily" } },
      },
      {
        kind: "bounty",
        title: "Duplicate weekdays",
        stars: 2,
        recurrence: {
          kind: "recurring",
          startsOn: "2026-09-13",
          cadence: { kind: "weekly", days: ["sun", "sun"] },
        },
      },
      {
        kind: "bounty",
        title: "Late month",
        stars: 2,
        recurrence: {
          kind: "recurring",
          startsOn: "2026-09-13",
          cadence: { kind: "monthly", day: 29 },
        },
      },
    ];
    for (const body of invalidBodies) {
      const response = await handleCreateTask(
        req("http://familyos.test/api/tasks", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      assert.equal(response.status, 400);
    }

    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Clean porch",
          stars: 4,
          recurrence: { kind: "once" },
        }),
      }),
    );
    const definition = (await created.json()).definition as BountyDefinition;
    const bountyView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const advertisedOffering = bountyView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(advertisedOffering);
    const offering = advertisedOffering.offering;
    for (const member of ["former", "missing"]) {
      const response = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind: "claim-bounty",
            requestId: crypto.randomUUID(),
            offering,
            member,
            definitionRevision: advertisedOffering.definitionRevision,
          }),
        }),
      );
      assert.equal(response.status, 400);
    }
    const malformedClaim = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering: { ...offering, scheduledOn: bountyView.today },
          member: "dad",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    assert.equal(malformedClaim.status, 400);
    const malformedCompletion = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "complete-bounty",
          requestId: crypto.randomUUID(),
          claim: crypto.randomUUID(),
          revision: -1,
        }),
      }),
    );
    assert.equal(malformedCompletion.status, 400);
    const legacy = await handlePostTaskEvents(
      req("http://familyos.test/api/tasks/events", {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              kind: "skipped",
              task: definition.id,
              window: bountyView.today,
            },
          ],
        }),
      }),
    );
    assert.equal(legacy.status, 409);
    const legacyEdit = await handleSaveTask(
      req("http://familyos.test/api/tasks", {
        method: "PUT",
        body: JSON.stringify({
          id: definition.id,
          title: "Changed through legacy editor",
          type: "chore",
          recurrence: { kind: "daily" },
          assignment: { kind: "fixed", member: "dad" },
          stars: 10,
        }),
      }),
    );
    assert.equal(legacyEdit.status, 404);
    assert.equal(
      (
        (await (
          await handleGetTasks(req("http://familyos.test/api/tasks"))
        ).json()) as TasksViewRead
      ).availableBounties.some(
        (row) => row.offering.definition === definition.id,
      ),
      true,
    );
  });

  test("completion credits the captured reward once and stale retries cannot award again", async () => {
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Sweep garage",
          stars: 6,
          recurrence: { kind: "once" },
        }),
      }),
    );
    const definition = (await created.json()).definition as BountyDefinition;
    const available = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const advertisedOffering = available.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(advertisedOffering);
    const offering = advertisedOffering.offering;
    await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering,
          member: "ellie",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    const claimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const claimedBounty = claimed.bountyClaims.find(
      (row) => row.claim.offering.definition === definition.id,
    );
    const claim = claimedBounty?.claim;
    assert.ok(claim);
    assert.ok(claimedBounty);
    const first = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "complete-bounty",
          requestId: crypto.randomUUID(),
          claim: claim.id,
          revision: claimedBounty.revision,
        }),
      }),
    );
    assert.equal(first.status, 200);
    const stale = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "complete-bounty",
          requestId: crypto.randomUUID(),
          claim: claim.id,
          revision: claimedBounty.revision,
        }),
      }),
    );
    assert.equal(stale.status, 409);
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const balanceBefore =
      before.starBalances.find((row) => row.member === "ellie")?.balance ?? 0;
    assert.equal(
      after.starBalances.find((row) => row.member === "ellie")?.balance,
      balanceBefore + 6,
    );
  });

  test("completion and release serialize against the same claim revision", async () => {
    const before = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Rake leaves",
          stars: 9,
          recurrence: { kind: "once" },
        }),
      }),
    );
    const definition = (await created.json()).definition as BountyDefinition;
    const available = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const advertisedOffering = available.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(advertisedOffering);
    const offering = advertisedOffering.offering;
    await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering,
          member: "dad",
          definitionRevision: advertisedOffering.definitionRevision,
        }),
      }),
    );
    const claimed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const row = claimed.bountyClaims.find(
      (candidate) => candidate.claim.offering.definition === definition.id,
    );
    assert.ok(row);
    const commands = ["complete-bounty", "release-bounty"].map((kind) =>
      handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind,
            requestId: crypto.randomUUID(),
            claim: row.claim.id,
            revision: row.revision,
          }),
        }),
      ),
    );
    const responses = await Promise.all(commands);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
    );
    const after = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const balanceBefore =
      before.starBalances.find((balance) => balance.member === "dad")
        ?.balance ?? 0;
    const completionWon = responses[0]?.status === 200;
    assert.equal(
      after.starBalances.find((balance) => balance.member === "dad")?.balance ??
        0,
      completionWon ? balanceBefore + 9 : balanceBefore,
    );
    assert.equal(
      after.availableBounties.some(
        (candidate) => candidate.offering.definition === definition.id,
      ),
      !completionWon,
    );
  });

  test("an accepted claim receipt replays after retirement without creating work for a retired member", async () => {
    const first = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Receipt replay",
          stars: 2,
          recurrence: { kind: "once" },
        }),
      }),
    );
    const second = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Fresh retired claim",
          stars: 2,
          recurrence: { kind: "once" },
        }),
      }),
    );
    const firstDefinition = (await first.json()).definition as BountyDefinition;
    const secondDefinition = (await second.json())
      .definition as BountyDefinition;
    const available = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"))
    ).json()) as TasksViewRead;
    const firstAdvertised = available.availableBounties.find(
      (row) => row.offering.definition === firstDefinition.id,
    );
    const secondAdvertised = available.availableBounties.find(
      (row) => row.offering.definition === secondDefinition.id,
    );
    assert.ok(firstAdvertised);
    assert.ok(secondAdvertised);
    const command = {
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: firstAdvertised.offering,
      member: "ellie",
      definitionRevision: firstAdvertised.definitionRevision,
    };
    const accepted = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify(command),
      }),
    );
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    await writeHousehold({
      familyName: "TasksHousehold",
      members: [
        { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        { id: "ellie", name: "Ellie", status: "retired" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 2,
    });
    try {
      const replay = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify(command),
        }),
      );
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), {
        receipt: { ...acceptedBody.receipt, status: "already-applied" },
      });
      const fresh = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind: "claim-bounty",
            requestId: crypto.randomUUID(),
            offering: secondAdvertised.offering,
            member: "ellie",
            definitionRevision: secondAdvertised.definitionRevision,
          }),
        }),
      );
      assert.equal(fresh.status, 400);
      const retiredView = (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"))
      ).json()) as TasksViewRead;
      assert.equal(
        retiredView.bountyClaims.some(
          (row) => row.claim.offering.definition === firstDefinition.id,
        ),
        false,
      );
      assert.equal(
        retiredView.availableBounties.some(
          (row) => row.offering.definition === firstDefinition.id,
        ),
        true,
      );
    } finally {
      await writeHousehold({
        familyName: "TasksHousehold",
        members: [
          { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
          { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
        ],
        calendarId: null,
        calendarTimeZone: null,
        listIds: [],
        timeZone: "America/New_York",
        configVersion: 3,
      });
    }
  });

  test("recurring Bounties roll to one current offering while older claims persist", async () => {
    const beforeStart = new Date("2026-10-03T16:00:00Z");
    const sunday = new Date("2026-10-04T16:00:00Z");
    const monday = new Date("2026-10-05T16:00:00Z");
    const tuesday = new Date("2026-10-06T16:00:00Z");
    const saturday = new Date("2026-10-10T16:00:00Z");
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Sweep the patio",
          stars: 4,
          recurrence: {
            kind: "recurring",
            startsOn: "2026-10-04",
            cadence: { kind: "daily" },
          },
        }),
      }),
      sunday,
    );
    assert.equal(created.status, 200);
    const definition = (await created.json()).definition as BountyDefinition;

    const early = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), beforeStart)
    ).json()) as TasksViewRead;
    assert.equal(
      early.availableBounties.some(
        (row) => row.offering.definition === definition.id,
      ),
      false,
    );

    const sundayView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), sunday)
    ).json()) as TasksViewRead;
    const sundayOffering = sundayView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(sundayOffering);
    assert.deepEqual(sundayOffering.offering, {
      kind: "recurring",
      definition: definition.id,
      intervalStart: "2026-10-04",
    });

    const mondayView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), monday)
    ).json()) as TasksViewRead;
    const mondayOffering = mondayView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(mondayOffering);
    assert.equal(mondayOffering.offering.kind, "recurring");
    if (mondayOffering.offering.kind !== "recurring") return;
    assert.equal(mondayOffering.offering.intervalStart, "2026-10-05");

    const stale = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering: sundayOffering.offering,
          member: "dad",
          definitionRevision: sundayOffering.definitionRevision,
        }),
      }),
      monday,
    );
    assert.equal(stale.status, 409);

    const mondayClaim = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering: mondayOffering.offering,
          member: "dad",
          definitionRevision: mondayOffering.definitionRevision,
        }),
      }),
      monday,
    );
    assert.equal(mondayClaim.status, 200);

    const tuesdayView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), tuesday)
    ).json()) as TasksViewRead;
    const tuesdayOffering = tuesdayView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.ok(tuesdayOffering);
    const tuesdayClaim = await handleBountyCommand(
      req("http://familyos.test/api/tasks", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "claim-bounty",
          requestId: crypto.randomUUID(),
          offering: tuesdayOffering.offering,
          member: "dad",
          definitionRevision: tuesdayOffering.definitionRevision,
        }),
      }),
      tuesday,
    );
    assert.equal(tuesdayClaim.status, 200);
    const overlapping = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), tuesday)
    ).json()) as TasksViewRead;
    assert.equal(
      overlapping.bountyClaims.filter(
        (row) => row.claim.offering.definition === definition.id,
      ).length,
      2,
    );

    const afterMissedIntervals = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), saturday)
    ).json()) as TasksViewRead;
    const current = afterMissedIntervals.availableBounties.filter(
      (row) => row.offering.definition === definition.id,
    );
    assert.equal(current.length, 1);
    assert.equal(current[0]?.offering.kind, "recurring");
    if (current[0]?.offering.kind === "recurring") {
      assert.equal(current[0].offering.intervalStart, "2026-10-10");
    }
    assert.equal(
      afterMissedIntervals.bountyClaims.filter(
        (row) => row.claim.offering.definition === definition.id,
      ).length,
      2,
    );

    const balanceBefore =
      afterMissedIntervals.starBalances.find((row) => row.member === "dad")
        ?.balance ?? 0;
    for (const row of afterMissedIntervals.bountyClaims.filter(
      (candidate) =>
        candidate.claim.offering.definition === definition.id &&
        candidate.state.kind === "unfinished",
    )) {
      const completion = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind: "complete-bounty",
            requestId: crypto.randomUUID(),
            claim: row.claim.id,
            revision: row.revision,
          }),
        }),
        saturday,
      );
      assert.equal(completion.status, 200);
    }
    const completed = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), saturday)
    ).json()) as TasksViewRead;
    assert.equal(
      completed.starBalances.find((row) => row.member === "dad")?.balance,
      balanceBefore + 8,
    );
  });

  test("recurring release reopens only an offering whose interval is current", async () => {
    const sunday = new Date("2026-10-11T16:00:00Z");
    const monday = new Date("2026-10-12T16:00:00Z");
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Set out recycling",
          stars: 3,
          recurrence: {
            kind: "recurring",
            startsOn: "2026-10-11",
            cadence: { kind: "weekly", days: ["sun", "mon"] },
          },
        }),
      }),
      sunday,
    );
    const definition = (await created.json()).definition as BountyDefinition;

    async function claimCurrent(now: Date) {
      const view = (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"), now)
      ).json()) as TasksViewRead;
      const offering = view.availableBounties.find(
        (row) => row.offering.definition === definition.id,
      );
      assert.ok(offering);
      const response = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind: "claim-bounty",
            requestId: crypto.randomUUID(),
            offering: offering.offering,
            member: "dad",
            definitionRevision: offering.definitionRevision,
          }),
        }),
        now,
      );
      assert.equal(response.status, 200);
      return (
        (await response.json()) as {
          receipt: { result: { claim: { id: string }; revision: number } };
        }
      ).receipt.result;
    }

    async function release(
      claim: Awaited<ReturnType<typeof claimCurrent>>,
      now: Date,
    ) {
      const response = await handleBountyCommand(
        req("http://familyos.test/api/tasks", {
          method: "PATCH",
          body: JSON.stringify({
            kind: "release-bounty",
            requestId: crypto.randomUUID(),
            claim: claim.claim.id,
            revision: claim.revision,
          }),
        }),
        now,
      );
      assert.equal(response.status, 200);
    }

    const sundayClaim = await claimCurrent(sunday);
    const mondayClaim = await claimCurrent(monday);
    await release(sundayClaim, monday);
    let mondayView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), monday)
    ).json()) as TasksViewRead;
    assert.equal(
      mondayView.availableBounties.some(
        (row) => row.offering.definition === definition.id,
      ),
      false,
    );

    await release(mondayClaim, monday);
    mondayView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), monday)
    ).json()) as TasksViewRead;
    const reopened = mondayView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.deepEqual(reopened?.offering, {
      kind: "recurring",
      definition: definition.id,
      intervalStart: "2026-10-12",
    });
  });

  test("monthly recurring work waits for its first matching date and advances without backlog", async () => {
    const october = new Date("2026-10-29T16:00:00Z");
    const beforeFirst = new Date("2026-11-27T16:00:00Z");
    const first = new Date("2026-11-28T16:00:00Z");
    const next = new Date("2026-12-28T16:00:00Z");
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Clean the filter",
          stars: 5,
          recurrence: {
            kind: "recurring",
            startsOn: "2026-10-29",
            cadence: { kind: "monthly", day: 28 },
          },
        }),
      }),
      october,
    );
    const definition = (await created.json()).definition as BountyDefinition;
    const early = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), beforeFirst)
    ).json()) as TasksViewRead;
    assert.equal(
      early.availableBounties.some(
        (row) => row.offering.definition === definition.id,
      ),
      false,
    );
    const firstView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), first)
    ).json()) as TasksViewRead;
    const offering = firstView.availableBounties.find(
      (row) => row.offering.definition === definition.id,
    );
    assert.deepEqual(offering?.offering, {
      kind: "recurring",
      definition: definition.id,
      intervalStart: "2026-11-28",
    });
    assert.ok(offering);
    assert.equal(
      (
        await handleBountyCommand(
          req("http://familyos.test/api/tasks", {
            method: "PATCH",
            body: JSON.stringify({
              kind: "claim-bounty",
              requestId: crypto.randomUUID(),
              offering: offering.offering,
              member: "dad",
              definitionRevision: offering.definitionRevision,
            }),
          }),
          first,
        )
      ).status,
      200,
    );
    const nextView = (await (
      await handleGetTasks(req("http://familyos.test/api/tasks"), next)
    ).json()) as TasksViewRead;
    assert.deepEqual(
      nextView.availableBounties.find(
        (row) => row.offering.definition === definition.id,
      )?.offering,
      {
        kind: "recurring",
        definition: definition.id,
        intervalStart: "2026-12-28",
      },
    );
    assert.equal(
      nextView.bountyClaims.filter(
        (row) => row.claim.offering.definition === definition.id,
      ).length,
      1,
    );
  });

  test("Household Time Zone midnight advances recurring offering identity across fall DST", async () => {
    const beforeMidnight = new Date("2026-11-02T04:59:59Z");
    const atMidnight = new Date("2026-11-02T05:00:00Z");
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Refill humidifier",
          stars: 1,
          recurrence: {
            kind: "recurring",
            startsOn: "2026-11-01",
            cadence: { kind: "daily" },
          },
        }),
      }),
      beforeMidnight,
    );
    const definition = (await created.json()).definition as BountyDefinition;
    async function offeringAt(now: Date) {
      const view = (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"), now)
      ).json()) as TasksViewRead;
      return view.availableBounties.find(
        (row) => row.offering.definition === definition.id,
      )?.offering;
    }
    assert.deepEqual(await offeringAt(beforeMidnight), {
      kind: "recurring",
      definition: definition.id,
      intervalStart: "2026-11-01",
    });
    assert.deepEqual(await offeringAt(atMidnight), {
      kind: "recurring",
      definition: definition.id,
      intervalStart: "2026-11-02",
    });
  });

  test("retiring a member releases old and current recurring claims without reopening old work", async () => {
    const monday = new Date("2026-10-19T16:00:00Z");
    const tuesday = new Date("2026-10-20T16:00:00Z");
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "bounty",
          title: "Feed the birds",
          stars: 2,
          recurrence: {
            kind: "recurring",
            startsOn: "2026-10-19",
            cadence: { kind: "daily" },
          },
        }),
      }),
      monday,
    );
    const definition = (await created.json()).definition as BountyDefinition;
    for (const now of [monday, tuesday]) {
      const view = (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"), now)
      ).json()) as TasksViewRead;
      const offering = view.availableBounties.find(
        (row) => row.offering.definition === definition.id,
      );
      assert.ok(offering);
      assert.equal(
        (
          await handleBountyCommand(
            req("http://familyos.test/api/tasks", {
              method: "PATCH",
              body: JSON.stringify({
                kind: "claim-bounty",
                requestId: crypto.randomUUID(),
                offering: offering.offering,
                member: "ellie",
                definitionRevision: offering.definitionRevision,
              }),
            }),
            now,
          )
        ).status,
        200,
      );
    }

    await writeHousehold({
      familyName: "TasksHousehold",
      members: [
        { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
        { id: "ellie", name: "Ellie", status: "retired" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 4,
    });
    try {
      const reconciled = (await (
        await handleGetTasks(req("http://familyos.test/api/tasks"), tuesday)
      ).json()) as TasksViewRead;
      const reopened = reconciled.availableBounties.filter(
        (row) => row.offering.definition === definition.id,
      );
      assert.equal(reopened.length, 1);
      assert.deepEqual(reopened[0]?.offering, {
        kind: "recurring",
        definition: definition.id,
        intervalStart: "2026-10-20",
      });
      const released = loadBountyClaims(tasksDatabase()).filter(
        (row) => row.claim.offering.definition === definition.id,
      );
      assert.equal(released.length, 2);
      assert.ok(released.every((row) => row.state.kind === "released"));
    } finally {
      await writeHousehold({
        familyName: "TasksHousehold",
        members: [
          { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
          {
            id: "ellie",
            name: "Ellie",
            status: "active",
            color: "#f6c9c5",
          },
        ],
        calendarId: null,
        calendarTimeZone: null,
        listIds: [],
        timeZone: "America/New_York",
        configVersion: 5,
      });
    }
  });
});
