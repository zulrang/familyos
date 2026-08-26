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
  let handlePostTaskEvents: typeof import("./tasks-http.ts").handlePostTaskEvents;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;
  let cookieHeader: string;
  let loadEvents: typeof import("./store.ts").loadEvents;

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
    ({ loadEvents } = await import("./store.ts"));

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
  });

  test("create shows the same day; timed sorts before untimed", async () => {
    const untimed = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Walk dog",
          type: "chore",
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

  test("completion increments progress; a duplicate stores one fact", async () => {
    const created = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Trash",
          type: "chore",
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

  test("rotation creation requires a nonempty active-member order", async () => {
    const empty = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Empty rotation",
          type: "chore",
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

  test("create rejects recurrence and retired members", async () => {
    const recurrence = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Nope",
          type: "chore",
          assignment: { kind: "fixed", member: "dad" },
          recurrence: { kind: "weekly", days: ["mon"] },
        }),
      }),
    );
    assert.equal(recurrence.status, 400);
    const missing = await handleCreateTask(
      req("http://familyos.test/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Nope",
          type: "chore",
          assignment: { kind: "fixed", member: "ghost" },
        }),
      }),
    );
    assert.equal(missing.status, 400);
  });
});
