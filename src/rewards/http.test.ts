import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { handlePair } from "@/displays/pairing-http";
import { writeHousehold } from "@/settings/settings";
import { handleAdminSession } from "@/shared/admin-auth";
import { emitStartupPairingCode } from "@/shared/pairing";
import { tasksDatabase } from "@/tasks/store";
import { handleRewards } from "./http";

describe("Rewards authorization and commands", () => {
  let dir: string, adminCookie: string, wallCookie: string;
  const origin = "http://familyos.test";
  function request(
    admin: boolean,
    body?: unknown,
    cookie = admin ? adminCookie : wallCookie,
    source = origin,
  ) {
    return new Request(`${origin}/${admin ? "admin/" : ""}api/rewards`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: source,
        "x-familyos-admin": "1",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rewards-http-"));
    vi.stubEnv("FAMILYOS_DATA_DIR", dir);
    vi.stubEnv("FAMILYOS_ADMIN_PIN", "123456");
    await writeHousehold({
      familyName: "Family",
      members: [
        { id: "a", name: "Alex", status: "active", color: "#a9d8d2" },
        { id: "old", name: "Retired", status: "retired" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 1,
    });
    const login = await handleAdminSession(
      new Request(`${origin}/admin/api/session`, {
        method: "POST",
        headers: {
          origin,
          "x-familyos-admin": "1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ pin: "123456" }),
      }),
    );
    adminCookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const code = await emitStartupPairingCode();
    const pair = await handlePair(
      new Request(`${origin}/api/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
    );
    wallCookie = pair.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  test("anonymous, cross-origin, and wrong credentials cannot mutate", async () => {
    expect(
      (await handleRewards(request(false, undefined, ""), tasksDatabase))
        .status,
    ).toBe(401);
    expect(
      (
        await handleRewards(
          request(true, undefined, wallCookie),
          tasksDatabase,
          true,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleRewards(
          request(
            false,
            { kind: "goal", member: "a", reward: null },
            wallCookie,
            "http://other.test",
          ),
          tasksDatabase,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleRewards(
          request(true, {}, adminCookie, "http://other.test"),
          tasksDatabase,
          true,
        )
      ).status,
    ).toBe(403);
  });
  test("wall mutations use the browser Host when Next uses an internal request hostname", async () => {
    const response = await handleRewards(
      new Request("http://localhost:4320/api/rewards", {
        method: "POST",
        headers: {
          host: "familyos.test",
          origin,
          cookie: wallCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "goal", member: "a", reward: null }),
      }),
      tasksDatabase,
    );
    expect(response.status).toBe(200);
  });
  test("admin creates real catalog, wall cannot edit it, and only active members select goals", async () => {
    const id = crypto.randomUUID(),
      create = {
        kind: "create",
        id,
        draft: {
          name: "Movie",
          description: "Choose a film",
          cost: 2,
          icon: "image",
        },
      };
    expect(
      (await handleRewards(request(true, create), tasksDatabase, true)).status,
    ).toBe(200);
    expect(
      (await handleRewards(request(false, create), tasksDatabase)).status,
    ).toBe(400);
    expect(
      (
        await handleRewards(
          request(false, { kind: "goal", member: "old", reward: id }),
          tasksDatabase,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleRewards(
          request(false, { kind: "goal", member: "a", reward: id }),
          tasksDatabase,
        )
      ).status,
    ).toBe(200);
    const read = await handleRewards(request(false), tasksDatabase);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const data = await read.json();
    expect(data.members.map((m: { id: string }) => m.id)).toEqual(["a"]);
    expect(data.goals).toEqual([{ member: "a", reward: id }]);
    expect(
      (
        await handleRewards(
          request(false, {
            kind: "spend",
            id: crypto.randomUUID(),
            member: "a",
            reward: id,
            revision: 1,
          }),
          tasksDatabase,
        )
      ).status,
    ).toBe(409);
  });
});
