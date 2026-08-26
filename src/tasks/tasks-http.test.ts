import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { EventReceipt, TaskDefinition, TasksViewRead } from "./types";

describe("Tasks HTTP", () => {
  let dataRoot: string;
  let handleGetTasks: typeof import("./tasks-http.ts").handleGetTasks;
  let handleCreateTask: typeof import("./tasks-http.ts").handleCreateTask;
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

    ({ handleGetTasks, handleCreateTask, handlePostTaskEvents } = await import(
      "./tasks-http.ts"
    ));
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
  });

  test("create shows the same day; timed sorts before untimed", async () => {
    const untimed = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Walk dog",
          type: "chore",
          recurrence: { kind: "daily" },
          member: "dad",
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
          member: "dad",
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

  test("create persists non-daily recurrence with stars and defaults omitted stars to zero", async () => {
    const omitted = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Default stars",
          type: "chore",
          recurrence: { kind: "monthly", day: 28 },
          member: "dad",
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
          member: "ellie",
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
            member: "dad",
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
          member: "dad",
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

  test("completion increments progress; a duplicate stores one fact", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Trash",
          type: "chore",
          recurrence: { kind: "daily" },
          member: "ellie",
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
          member: "dad",
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
            member: "dad",
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
            member: "dad",
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
          member: "ghost",
        }),
      }),
    );
    assert.equal(missing.status, 400);
  });
});
