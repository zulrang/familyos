import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readHousehold, writeHousehold } from "@/settings/settings";
import { handleAdminSession } from "@/shared/admin-auth";
import {
  type AdminTaskSourcesRead,
  handleAdminDeruptToken,
  handleAdminTaskSources,
} from "./admin-http";
import { deruptConfig, deruptConfigKey } from "./config";
import { resetExternalTaskSources, setSourceStatus } from "./source-status";
import { readSavedDeruptToken } from "./token-store";

// Obviously fake tokens; real ones never appear in tests.
const SAVED = "fake_saved_token_0000000000wxyz";
const REPLACEMENT = "fake_replacement_token_000000abcd";
const FROM_ENV = "fake_env_token_00000000000000envv";

let dir: string;
let cookie: string;

function request(body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new Request("http://familyos.test/admin/api/task-sources", {
    method,
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
  vi.stubEnv("FAMILYOS_DERUPT_TOKEN", FROM_ENV);
  setSourceStatus(
    "derupt",
    {
      state: "halted",
      reason: "connection_revoked",
      at: "2026-11-15T17:00:00.000Z",
      lastSuccessAt: "2026-11-15T16:59:00.000Z",
      lastProblem: null,
    },
    deruptConfigKey(deruptConfig(process.env)),
  );
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

describe("the Derupt token", () => {
  const put = (token: unknown) =>
    handleAdminDeruptToken(request({ token }, "PUT"));
  const clear = () => handleAdminDeruptToken(request(undefined, "DELETE"));
  const derupt = async (response: Response) => {
    const text = await response.text();
    return {
      text,
      source: (JSON.parse(text) as AdminTaskSourcesRead).sources[0],
    };
  };

  test("saves a token owner-only and shows only its last four characters", async () => {
    const response = await put(SAVED);
    expect(response.status).toBe(200);
    const { text, source } = await derupt(response);
    expect(text).not.toContain(SAVED);
    expect(source.token).toEqual({
      source: "saved",
      ending: "wxyz",
      environmentSet: false,
    });
    expect(source.status).toEqual({ state: "starting" });
    expect(readSavedDeruptToken()).toBe(SAVED);
    const file = path.join(dir, "derupt-token.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(
      await handleAdminTaskSources(request()).then((r) => r.text()),
    ).not.toContain(SAVED);
  });

  test("replaces the saved token", async () => {
    await put(SAVED);
    const { text, source } = await derupt(await put(REPLACEMENT));
    expect(text).not.toContain(REPLACEMENT);
    expect(source.token.ending).toBe("abcd");
    expect(readSavedDeruptToken()).toBe(REPLACEMENT);
    expect(
      await readFile(path.join(dir, "derupt-token.json"), "utf8"),
    ).not.toContain(SAVED);
  });

  test("clears the saved token, and clearing nothing is fine", async () => {
    await put(SAVED);
    const { source } = await derupt(await clear());
    expect(source.token).toEqual({
      source: null,
      ending: null,
      environmentSet: false,
    });
    expect(source.status).toEqual({
      state: "disabled",
      reason: "not_configured",
    });
    expect(readSavedDeruptToken()).toBeNull();
    expect((await clear()).status).toBe(200);
  });

  test("shows a status only for the token now in use", async () => {
    vi.stubEnv("FAMILYOS_DERUPT_TOKEN", FROM_ENV);
    setSourceStatus(
      "derupt",
      {
        state: "halted",
        reason: "token_rejected",
        at: "2026-11-15T17:00:00.000Z",
        lastSuccessAt: null,
        lastProblem: null,
      },
      deruptConfigKey(deruptConfig(process.env)),
    );
    expect((await read()).sources[0].status.state).toBe("halted");
    // A new token supersedes the rejected one before the poller runs again.
    expect((await derupt(await put(SAVED))).source.status).toEqual({
      state: "starting",
    });
  });

  test("refuses a malformed token without echoing it", async () => {
    for (const token of ["fake short", "x".repeat(600), 42, null]) {
      const response = await put(token);
      expect(response.status).toBe(400);
      const text = await response.text();
      if (typeof token === "string") expect(text).not.toContain(token);
    }
    expect(readSavedDeruptToken()).toBeNull();
  });

  test("only a parent with a session may change it", async () => {
    await put(SAVED);
    cookie = "";
    expect((await put(REPLACEMENT)).status).toBe(401);
    expect((await clear()).status).toBe(401);
    expect(readSavedDeruptToken()).toBe(SAVED);
  });

  test("refuses writes that don't come from the admin interface", async () => {
    const forged = new Request(
      "http://familyos.test/admin/api/task-sources/derupt-token",
      {
        method: "PUT",
        headers: {
          cookie,
          origin: "http://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: REPLACEMENT }),
      },
    );
    expect((await handleAdminDeruptToken(forged)).status).toBe(403);
    expect(readSavedDeruptToken()).toBeNull();
  });

  describe("precedence with FAMILYOS_DERUPT_TOKEN", () => {
    beforeEach(() => vi.stubEnv("FAMILYOS_DERUPT_TOKEN", FROM_ENV));

    test("the variable is used when nothing is saved", async () => {
      const { text, source } = await derupt(
        await handleAdminTaskSources(request()),
      );
      expect(text).not.toContain(FROM_ENV);
      expect(source.token).toEqual({
        source: "environment",
        ending: "envv",
        environmentSet: true,
      });
      expect(source.status).toEqual({ state: "starting" });
    });

    test("a saved token wins, and clearing it falls back to the variable", async () => {
      const saved = await derupt(await put(SAVED));
      expect(saved.text).not.toContain(FROM_ENV);
      expect(saved.source.token).toEqual({
        source: "saved",
        ending: "wxyz",
        environmentSet: true,
      });
      expect((await derupt(await clear())).source.token).toEqual({
        source: "environment",
        ending: "envv",
        environmentSet: true,
      });
    });

    test("a malformed variable is reported, and a saved token replaces it", async () => {
      vi.stubEnv("FAMILYOS_DERUPT_TOKEN", "short");
      const before = (await read()).sources[0];
      expect(before.status).toEqual({
        state: "disabled",
        reason: "invalid_token",
      });
      expect(before.token).toEqual({
        source: "environment",
        ending: null,
        environmentSet: true,
      });
      expect((await derupt(await put(SAVED))).source.status).toEqual({
        state: "starting",
      });
    });
  });
});
