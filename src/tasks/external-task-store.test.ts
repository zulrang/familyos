import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createExternalTask, externalTaskFor } from "./external-task-store";
import { closeTasksDatabase, loadDefinitions, tasksDatabase } from "./store";
import {
  type AssignedTaskDraft,
  type Instant,
  parseInstant,
  parseLocalDate,
} from "./types";

let dir: string;

const date = parseLocalDate("2026-11-15");
const at = parseInstant("2026-11-15T17:00:00Z");
if (!date || !at) throw new Error("bad fixture");
const receivedAt: Instant = at;
const draft: AssignedTaskDraft = {
  title: "Take out the recycling",
  type: "chore",
  recurrence: { kind: "once", date },
  assignment: { kind: "fixed", member: "dad" },
  time: null,
  stars: 0,
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "familyos-external-store-"));
  vi.stubEnv("FAMILYOS_DATA_DIR", dir);
});

afterEach(async () => {
  closeTasksDatabase();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

test("one request creates one Task, across reopened storage", () => {
  const key = { source: "derupt", request: "work-1" };
  const first = createExternalTask(key, draft, receivedAt);
  expect(first.status).toBe("created");
  closeTasksDatabase();
  expect(externalTaskFor(key)).toBe(first.task);
  expect(
    createExternalTask(key, { ...draft, title: "Changed" }, receivedAt),
  ).toEqual({ status: "already-created", task: first.task });
  expect(loadDefinitions().map((row) => row.title)).toEqual([
    "Take out the recycling",
  ]);
});

test("the same request ID from another source is a different request", () => {
  createExternalTask({ source: "derupt", request: "1" }, draft, receivedAt);
  createExternalTask({ source: "other", request: "1" }, draft, receivedAt);
  expect(loadDefinitions()).toHaveLength(2);
});

test("receipts are append-only", () => {
  createExternalTask({ source: "derupt", request: "1" }, draft, receivedAt);
  expect(() =>
    tasksDatabase().exec("DELETE FROM external_task_requests"),
  ).toThrow(/append-only/);
});
