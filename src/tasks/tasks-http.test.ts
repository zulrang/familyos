import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  addLocalDays,
  type EventReceipt,
  type TaskDefinition,
  type TasksViewRead,
} from "./types";

describe("Tasks HTTP", () => {
  let dataRoot: string;
  let handleGetTasks: typeof import("./tasks-http.ts").handleGetTasks;
  let handleCreateTask: typeof import("./tasks-http.ts").handleCreateTask;
  let handleSaveTask: typeof import("./tasks-http.ts").handleSaveTask;
  let handlePostTaskEvents: typeof import("./tasks-http.ts").handlePostTaskEvents;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;
  let cookieHeader: string;
  let loadDefinitions: typeof import("./store.ts").loadDefinitions;
  let loadEvents: typeof import("./store.ts").loadEvents;
  let tasksDatabase: typeof import("./store.ts").tasksDatabase;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-tasks-http-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      handleGetTasks,
      handleCreateTask,
      handleSaveTask,
      handlePostTaskEvents,
    } = await import("./tasks-http.ts"));
    ({ writeHousehold } = await import("@/settings/settings"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE } = await import(
      "@/shared/pairing"
    ));
    ({ handlePair } = await import("@/displays/pairing-http"));
    ({ loadDefinitions, loadEvents, tasksDatabase } = await import(
      "./store.ts"
    ));

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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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

  test("GET exposes derived star balances without a writer route", async () => {
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
        definition: TaskDefinition;
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
      definition: TaskDefinition;
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
    const body = (await saved.json()) as { definition: TaskDefinition };
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
      definition: TaskDefinition;
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
    const body = (await saved.json()) as { definition: TaskDefinition };
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
      definition: TaskDefinition;
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
    const body = (await saved.json()) as { definition: TaskDefinition };
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
    const live = (await titleOnly.json()) as { definition: TaskDefinition };
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
      definition: TaskDefinition;
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
      definition: TaskDefinition;
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
});
