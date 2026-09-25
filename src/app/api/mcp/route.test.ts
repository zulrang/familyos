import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rewardsStore } from "@/rewards/store";
import { parseRewardAdminCommand } from "@/rewards/types";
import { writeHousehold } from "@/settings/settings";
import { correctAdminCompletion } from "@/tasks/admin-store";
import {
  closeTasksDatabase,
  loadDefinitions,
  loadStoredStarBalances,
  tasksDatabase,
} from "@/tasks/store";
import { nowInstant, parseLocalDate, parseTaskId } from "@/tasks/types";
import { DELETE, GET, POST } from "./route";

const origin = "http://familyos.test";
let token: string;
let dir: string;
let client: Client;
const draft = {
  title: "Wash dishes",
  type: "chore",
  assignment: { kind: "fixed", member: "alex" },
  recurrence: { kind: "daily" },
  time: null,
  stars: 3,
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  // Validate the wire response instead of asserting SDK result types.
  const content = result.content;
  if (!Array.isArray(content) || content[0]?.type !== "text")
    throw new Error("Missing MCP text result");
  return {
    error: result.isError === true,
    data: result.isError ? content[0].text : JSON.parse(content[0].text),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "familyos-mcp-"));
  token = randomBytes(32).toString("hex");
  vi.stubEnv("FAMILYOS_DATA_DIR", dir);
  vi.stubEnv("FAMILYOS_MCP_TOKEN", token);
  await writeHousehold({
    familyName: "Family",
    members: [
      { id: "alex", name: "Alex", status: "active", color: "#a9d8d2" },
      { id: "old", name: "Retired", status: "retired" },
    ],
    calendarId: null,
    calendarTimeZone: null,
    listIds: [],
    timeZone: "America/New_York",
    configVersion: 1,
  });
  client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (url, init) => {
        const req = new Request(url, init);
        return req.method === "POST"
          ? POST(req)
          : req.method === "GET"
            ? GET(req)
            : DELETE(req);
      },
    }),
  );
});
afterEach(async () => {
  await client?.close();
  closeTasksDatabase();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("MCP transport and authorization", () => {
  test("real SDK initialization, discovery and reads work without leaking settings", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "complete_task",
      "create_task",
      "edit_task",
      "list_members",
      "list_rewards",
      "list_tasks",
      "spend_reward",
    ]);
    expect((await call("list_members")).data).toEqual({
      familyName: "Family",
      timeZone: "America/New_York",
      members: [
        { id: "alex", name: "Alex", status: "active", color: "#a9d8d2" },
      ],
    });
    expect((await call("list_tasks")).data.occurrences).toEqual([]);
    expect((await call("list_rewards")).data.rewards).toEqual([]);
  });
  test("missing/wrong token, browser origins, rotation and disabled configuration fail closed", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: { requestId: randomUUID(), draft },
      },
    };
    for (const authorization of [
      "",
      "Bearer wrong",
      `Bearer ${randomBytes(32).toString("hex")}`,
    ]) {
      const response = await POST(
        request(body, { authorization, cookie: "familyos_admin=anything" }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const source of [origin, "null", "https://evil.test"]) {
      expect((await POST(request(body, { origin: source }))).status).toBe(403);
    }
    vi.stubEnv("FAMILYOS_MCP_TOKEN", randomBytes(32).toString("hex"));
    expect((await POST(request(body))).status).toBe(401);
    vi.stubEnv("FAMILYOS_MCP_TOKEN", "");
    expect((await POST(request(body))).status).toBe(503);
    vi.stubEnv("FAMILYOS_MCP_TOKEN", "short");
    expect((await POST(request(body))).status).toBe(503);
    expect(loadDefinitions()).toEqual([]);
  });
  test("unsupported methods, malformed and oversized requests are handled", async () => {
    for (const handler of [GET, DELETE]) {
      const response = await handler(
        new Request(`${origin}/api/mcp`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
    expect(
      (
        await POST(
          new Request(`${origin}/api/mcp`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect((await POST(request({ padding: "a".repeat(70_000) }))).status).toBe(
      413,
    );
  });
});

describe("MCP task and reward behavior", () => {
  test("create/edit retries survive database reopen and preserve definition history", async () => {
    const create = { requestId: randomUUID(), draft };
    const created = await call("create_task", create);
    expect(created.error).toBe(false);
    expect(await call("create_task", create)).toEqual(created);
    expect(
      (
        await call("create_task", {
          ...create,
          draft: { ...draft, title: "Different" },
        })
      ).error,
    ).toBe(true);
    const edit = {
      requestId: randomUUID(),
      task: created.data.definition.id,
      draft: { ...draft, recurrence: { kind: "weekly", days: ["mon"] } },
    };
    const edited = await call("edit_task", edit);
    expect(edited.error).toBe(false);
    expect(edited.data.definition.id).not.toBe(created.data.definition.id);
    closeTasksDatabase();
    expect(await call("edit_task", edit)).toEqual(edited);
    expect(loadDefinitions()).toHaveLength(2);
    expect((await call("edit_task", { ...edit, draft })).error).toBe(true);
    const renamed = await call("edit_task", {
      requestId: randomUUID(),
      task: edited.data.definition.id,
      draft: { ...edit.draft, title: "Monday dishes" },
    });
    expect(renamed.data.definition.title).toBe("Monday dishes");
    expect(await call("edit_task", edit)).toEqual(edited);
    expect(
      loadDefinitions().find((row) => row.id === edited.data.definition.id)
        ?.title,
    ).toBe("Monday dishes");
  });
  test("invalid dates, fields and inactive members cannot create tasks", async () => {
    for (const invalid of [
      { ...draft, assignment: { kind: "fixed", member: "old" } },
      { ...draft, assignment: { kind: "fixed", member: "missing" } },
      { ...draft, recurrence: { kind: "once", date: "2026-02-30" } },
      { ...draft, stars: -1 },
      { ...draft, injected: true },
    ])
      expect(
        (await call("create_task", { requestId: randomUUID(), draft: invalid }))
          .error,
      ).toBe(true);
    expect(loadDefinitions()).toEqual([]);
  });
  test("checking off an occurrence credits Stars once and rejects invented windows/members", async () => {
    const created = await call("create_task", {
      requestId: randomUUID(),
      draft,
    });
    const snapshot = (await call("list_tasks")).data;
    const input = {
      task: created.data.definition.id,
      window: snapshot.today,
      member: "alex",
    };
    expect(
      (await call("complete_task", { ...input, window: "2099-01-01" })).error,
    ).toBe(true);
    expect(
      (await call("complete_task", { ...input, task: "missing" })).error,
    ).toBe(true);
    expect(
      (await call("complete_task", { ...input, member: "old" })).error,
    ).toBe(true);
    expect((await call("complete_task", input)).data.status).toBe("inserted");
    expect((await call("complete_task", input)).data.status).toBe(
      "already-present",
    );
    expect(loadStoredStarBalances()).toEqual([{ member: "alex", balance: 3 }]);
    expect(
      (await call("list_tasks")).data.occurrences.find(
        (row: { window: string }) => row.window === snapshot.today,
      ).state,
    ).toBe("done");
  });
  test("an administratively undone completion cannot silently report success or award Stars again", async () => {
    const created = await call("create_task", {
      requestId: randomUUID(),
      draft,
    });
    const snapshot = (await call("list_tasks")).data;
    const task = parseTaskId(created.data.definition.id);
    const window = parseLocalDate(snapshot.today);
    if (!task || !window) throw new Error("Invalid fixture");
    const input = { task, window, member: "alex" };
    await call("complete_task", input);
    correctAdminCompletion({
      id: randomUUID(),
      task,
      window,
      by: null,
      reason: "Completed by mistake",
      at: nowInstant(),
      previous: null,
    });
    const result = await call("complete_task", input);
    expect(result.error).toBe(true);
    expect(result.data).toContain("not available");
    expect(loadStoredStarBalances()).toEqual([{ member: "alex", balance: 0 }]);
  });
  test("reward spending enforces revisions, available Stars and retry receipts", async () => {
    const rewardId = randomUUID();
    const reward = parseRewardAdminCommand({
      kind: "create",
      id: rewardId,
      draft: {
        name: "Movie",
        description: "Choose a film",
        cost: 2,
        icon: "film",
      },
    });
    if (!reward) throw new Error("Invalid fixture");
    rewardsStore(tasksDatabase()).administer(reward);
    const spend = {
      requestId: randomUUID(),
      member: "alex",
      reward: rewardId,
      revision: 1,
    };
    expect((await call("spend_reward", spend)).error).toBe(true);
    const created = await call("create_task", {
      requestId: randomUUID(),
      draft,
    });
    const snapshot = (await call("list_tasks")).data;
    await call("complete_task", {
      task: created.data.definition.id,
      window: snapshot.today,
      member: "alex",
    });
    expect((await call("spend_reward", { ...spend, revision: 2 })).error).toBe(
      true,
    );
    expect(
      (await call("spend_reward", { ...spend, member: "old" })).error,
    ).toBe(true);
    const result = await call("spend_reward", spend);
    expect(result.error).toBe(false);
    expect(result.data.spend).toMatchObject({
      cost: 2,
      member: "alex",
      reward: rewardId,
    });
    rewardsStore(tasksDatabase()).administer({
      kind: "retire",
      id: rewardId,
      revision: 1,
    });
    closeTasksDatabase();
    expect(await call("spend_reward", spend)).toEqual(result);
    expect((await call("spend_reward", { ...spend, revision: 2 })).error).toBe(
      true,
    );
    expect(
      (await call("spend_reward", { ...spend, requestId: randomUUID() })).error,
    ).toBe(true);
    expect(loadStoredStarBalances()).toEqual([{ member: "alex", balance: 1 }]);
  });
});
