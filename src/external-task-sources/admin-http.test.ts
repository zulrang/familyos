import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readHousehold, writeHousehold } from "@/settings/settings";
import { handleAdminSession } from "@/shared/admin-auth";
import {
  type AdminTaskSourcesRead,
  handleAdminTaskSources,
} from "./admin-http";
import { resetExternalTaskSources, setSourceStatus } from "./source-status";

let dir: string;
let cookie: string;

function request(body?: unknown) {
  return new Request("http://familyos.test/admin/api/task-sources", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin: "http://familyos.test",
      "x-familyos-admin": "1",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function read(): Promise<AdminTaskSourcesRead> {
  return (await handleAdminTaskSources(request())).json();
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "familyos-task-sources-"));
  vi.stubEnv("FAMILYOS_DATA_DIR", dir);
  vi.stubEnv("FAMILYOS_ADMIN_PIN", "123456");
  vi.stubEnv("FAMILYOS_DERUPT_TOKEN", "");
  resetExternalTaskSources();
  await writeHousehold({
    familyName: "Family",
    members: [
      { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
      { id: "gran", name: "Gran", status: "retired" },
    ],
    calendarId: null,
    calendarTimeZone: null,
    listIds: [],
    timeZone: "America/New_York",
    configVersion: 1,
  });
  cookie = "";
  const login = await handleAdminSession(
    new Request("http://familyos.test/admin/api/session", {
      method: "POST",
      headers: {
        origin: "http://familyos.test",
        "x-familyos-admin": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ pin: "123456" }),
    }),
  );
  cookie = login.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
});

afterEach(async () => {
  resetExternalTaskSources();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

test("reads no default and an unconfigured source", async () => {
  expect(await read()).toMatchObject({
    defaultMember: null,
    version: 1,
    sources: [
      {
        id: "derupt",
        name: "Derupt",
        status: { state: "disabled", reason: "not_configured" },
      },
    ],
  });
});

test("reports the running poller's status without request text", async () => {
  setSourceStatus("derupt", {
    state: "halted",
    reason: "connection_revoked",
    at: "2026-11-15T17:00:00.000Z",
    lastSuccessAt: "2026-11-15T16:59:00.000Z",
    lastProblem: null,
  });
  expect((await read()).sources[0].status).toEqual({
    state: "halted",
    reason: "connection_revoked",
    at: "2026-11-15T17:00:00.000Z",
    lastSuccessAt: "2026-11-15T16:59:00.000Z",
    lastProblem: null,
  });
});

test("saves, then clears, the default member by stable ID", async () => {
  const saved = await handleAdminTaskSources(
    request({ defaultMember: "dad", expectedVersion: 1 }),
  );
  expect(saved.status).toBe(200);
  expect((await readHousehold()).externalTaskDefaultMember).toBe("dad");
  const cleared = await handleAdminTaskSources(
    request({ defaultMember: null, expectedVersion: 2 }),
  );
  expect(cleared.status).toBe(200);
  expect((await readHousehold()).externalTaskDefaultMember).toBeNull();
});

test("refuses a retired or unknown member, a stale version, and no session", async () => {
  for (const defaultMember of ["gran", "nobody", 7]) {
    const response = await handleAdminTaskSources(
      request({ defaultMember, expectedVersion: 1 }),
    );
    expect(response.status).toBe(400);
  }
  const stale = await handleAdminTaskSources(
    request({ defaultMember: "dad", expectedVersion: 0 }),
  );
  expect(stale.status).toBe(409);
  cookie = "";
  expect((await handleAdminTaskSources(request())).status).toBe(401);
  expect((await readHousehold()).externalTaskDefaultMember).toBeNull();
});
