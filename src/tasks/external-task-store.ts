import { insertDefinition, tasksDatabase, taskTransaction } from "./store";
import {
  type AssignedTaskDraft,
  createDefinition,
  type Instant,
  parseTaskId,
  type TaskId,
} from "./types";

/**
 * Identifies one request from an External Task Source: the source's own name
 * and the request's ID within that source. Delivery may repeat; the key does
 * not.
 */
export type ExternalTaskKey = Readonly<{ source: string; request: string }>;

export type ExternalTaskReceipt = Readonly<{
  status: "created" | "already-created";
  task: TaskId;
}>;

/** The Task an earlier delivery of this request created, if any. */
export function externalTaskFor(key: ExternalTaskKey): TaskId | null {
  const row = tasksDatabase()
    .prepare(
      "SELECT task FROM external_task_requests WHERE source = ? AND request = ?",
    )
    .get(key.source, key.request);
  if (!row) return null;
  const task = parseTaskId(row.task);
  if (!task) throw new Error("corrupt external task request row");
  return task;
}

/**
 * Create the Task for an external request exactly once. The receipt and the
 * definition commit together, so a redelivery after a crash at any point finds
 * either both or neither.
 */
export function createExternalTask(
  key: ExternalTaskKey,
  draft: AssignedTaskDraft,
  receivedAt: Instant,
): ExternalTaskReceipt {
  return taskTransaction(() => {
    const existing = externalTaskFor(key);
    if (existing) return { status: "already-created", task: existing };
    const definition = createDefinition(draft);
    insertDefinition(definition);
    tasksDatabase()
      .prepare(
        "INSERT INTO external_task_requests (source, request, task, received_at) VALUES (?, ?, ?, ?)",
      )
      .run(key.source, key.request, definition.id, receivedAt);
    return { status: "created", task: definition.id };
  });
}
