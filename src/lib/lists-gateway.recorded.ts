/**
 * DESIGN-DEVIATION: hand-authored Google Tasks HTTP shapes, not cassettes from a
 * live capture and not a live lane. Code-design Parity allows recorded responses
 * or a manual live run; this stands in until either exists, so the real
 * `tasks.ts` adapter still shares `assertListsGatewayContract` with the Fake.
 * Upgrade: replay captured cassettes, or gate a live run on env.
 */

const TASKS_ORIGIN = "https://tasks.googleapis.com/tasks/v1";

type GTask = {
  id: string;
  title: string;
  status: "needsAction" | "completed";
  position: string;
  deleted?: boolean;
  parent?: string;
};

type GList = { id: string; title: string; tasks: Map<string, GTask> };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function empty(status: number): Response {
  return new Response(null, { status });
}

export function createRecordedTasksGfetch(): (
  url: string,
  init?: RequestInit,
) => Promise<Response> {
  const lists = new Map<string, GList>();
  let listSeq = 0;
  let taskSeq = 0;

  return async (url, init) => {
    const u = new URL(url);
    if (!u.href.startsWith(TASKS_ORIGIN)) {
      throw new Error(`unexpected recorded URL ${url}`);
    }
    const path = u.pathname.replace(/^\/tasks\/v1/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body != null
          ? String(init.body)
          : "";
    const body = bodyText
      ? (JSON.parse(bodyText) as Record<string, unknown>)
      : {};

    const listMeta = path.match(/^\/users\/@me\/lists\/([^/]+)$/);
    if (listMeta) {
      const listId = decodeURIComponent(listMeta[1] ?? "");
      const list = lists.get(listId);
      if (method === "GET") {
        if (!list) return empty(404);
        return json({ id: list.id, title: list.title });
      }
      if (method === "PATCH") {
        if (!list) return empty(404);
        list.title = String(body.title ?? list.title);
        return json({ id: list.id, title: list.title });
      }
    }

    if (path === "/users/@me/lists" && method === "POST") {
      listSeq += 1;
      const id = `glist-${listSeq}`;
      const title = String(body.title ?? "List");
      lists.set(id, { id, title, tasks: new Map() });
      return json({ id, title });
    }

    const taskMeta = path.match(/^\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    if (taskMeta) {
      const listId = decodeURIComponent(taskMeta[1] ?? "");
      const taskId = taskMeta[2] ? decodeURIComponent(taskMeta[2]) : null;
      const list = lists.get(listId);
      if (!list) return empty(404);

      if (!taskId && method === "GET") {
        return json({
          items: [...list.tasks.values()].filter((t) => !t.deleted),
        });
      }

      if (!taskId && method === "POST") {
        taskSeq += 1;
        const id = `gtask-${taskSeq}`;
        const position = String(taskSeq).padStart(20, "0");
        const task: GTask = {
          id,
          title: String(body.title ?? ""),
          status: "needsAction",
          position,
        };
        list.tasks.set(id, task);
        return json(task);
      }

      if (taskId && method === "PATCH") {
        const task = list.tasks.get(taskId);
        if (!task || task.deleted) return empty(404);
        if (body.title !== undefined) task.title = String(body.title);
        if (body.status === "completed" || body.status === "needsAction") {
          task.status = body.status;
        }
        return json(task);
      }

      if (taskId && method === "DELETE") {
        const task = list.tasks.get(taskId);
        if (!task) return empty(404);
        list.tasks.delete(taskId);
        return empty(204);
      }
    }

    const clearMeta = path.match(/^\/lists\/([^/]+)\/clear$/);
    if (clearMeta && method === "POST") {
      const list = lists.get(decodeURIComponent(clearMeta[1] ?? ""));
      if (!list) return empty(404);
      for (const [id, task] of list.tasks) {
        if (task.status === "completed") list.tasks.delete(id);
      }
      return empty(204);
    }

    throw new Error(`unhandled recorded Tasks ${method} ${path}`);
  };
}
