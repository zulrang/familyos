import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ADMIN_IDLE_MS,
  adminWriteAllowed,
  handleAdminSession,
  requireAdmin,
} from "./admin-auth";

describe("parent PIN sessions", () => {
  test("uses the direct LAN Host when Next supplies an internal request hostname", () => {
    const local = new Request("http://localhost:3000/admin/api/session", {
      method: "POST",
      headers: {
        host: "192.168.1.10:3000",
        origin: "http://192.168.1.10:3000",
        "x-familyos-admin": "1",
      },
    });
    expect(adminWriteAllowed(local)).toBe(true);
    local.headers.set("origin", "http://other.test");
    local.headers.set("x-forwarded-host", "other.test");
    expect(adminWriteAllowed(local)).toBe(false);
  });
  let dir: string;
  let jar: Map<string, string>;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "familyos-admin-auth-"));
    vi.stubEnv("FAMILYOS_DATA_DIR", dir);
    vi.stubEnv("FAMILYOS_ADMIN_PIN", "123456");
    jar = new Map();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  function request(
    method = "GET",
    body?: unknown,
    origin = "http://familyos.test",
  ) {
    return new Request("http://familyos.test/admin/api/session", {
      method,
      headers: {
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        origin,
        "x-familyos-admin": "1",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function call(method = "GET", body?: unknown, now = Date.now()) {
    const response = await handleAdminSession(request(method, body), now);
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(";")[0].split("=");
      jar.set(name, value);
    }
    return response;
  }

  test("disabled unless the server has exactly six digits", async () => {
    for (const pin of ["", "12345", "abcdef", "1234567"]) {
      vi.stubEnv("FAMILYOS_ADMIN_PIN", pin);
      expect((await call("POST", { pin })).status).toBe(503);
      expect(requireAdmin(request())?.status).toBe(401);
    }
  });
  test("PIN-only login issues HttpOnly credentials and all responses are uncacheable", async () => {
    expect(requireAdmin(request())?.status).toBe(401);
    const response = await call("POST", { pin: "123456" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      response.headers
        .getSetCookie()
        .some(
          (line) =>
            line.startsWith("familyos_admin=") &&
            line.includes("HttpOnly") &&
            line.includes("SameSite=Strict"),
        ),
    ).toBe(true);
    expect(requireAdmin(request())).toBeNull();
  });
  test("reads do not extend inactivity; expiry is enforced server-side", async () => {
    const now = Date.now();
    await call("POST", { pin: "123456" }, now);
    expect(
      await (await call("GET", undefined, now + ADMIN_IDLE_MS - 1)).json(),
    ).toEqual({ status: "unlocked", expiresAt: now + ADMIN_IDLE_MS });
    expect(
      await (await call("GET", undefined, now + ADMIN_IDLE_MS)).json(),
    ).toEqual({ status: "locked" });
    expect(requireAdmin(request())?.status).toBe(401);
    expect(
      (await call("POST", { activity: true }, now + ADMIN_IDLE_MS)).status,
    ).toBe(401);
  });
  test("explicit activity extends a live session", async () => {
    const now = Date.now();
    await call("POST", { pin: "123456" }, now);
    const activityAt = now + 60_000;
    expect(
      await (await call("POST", { activity: true }, activityAt)).json(),
    ).toEqual({ status: "unlocked", expiresAt: activityAt + ADMIN_IDLE_MS });
  });
  test("lock and PIN rotation revoke the server session", async () => {
    await call("POST", { pin: "123456" });
    const credential = jar.get("familyos_admin");
    await call("DELETE");
    jar.set("familyos_admin", credential ?? "");
    expect(requireAdmin(request())?.status).toBe(401);
    await call("POST", { pin: "123456" });
    vi.stubEnv("FAMILYOS_ADMIN_PIN", "654321");
    expect(requireAdmin(request())?.status).toBe(401);
  });
  test("cross-origin login, activity, and lock are rejected", async () => {
    for (const method of ["POST", "DELETE"]) {
      expect(
        (
          await handleAdminSession(
            request(
              method,
              method === "POST" ? { pin: "123456" } : undefined,
              "http://other.test",
            ),
          )
        ).status,
      ).toBe(403);
    }
    expect(requireAdmin(request("POST", {}, "http://other.test"))?.status).toBe(
      403,
    );
  });
  test("five failures lock the device for five minutes after the fifth failure", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++)
      expect(
        (await call("POST", { pin: "000000" }, now + i * 30_000)).status,
      ).toBe(401);
    // The oldest failure has expired, but the cooldown has not.
    const blocked = await call("POST", { pin: "123456" }, now + 310_000);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call("POST", { pin: "123456" }, now + 420_000)).status).toBe(
      200,
    );
  });
  test("clearing device cookies cannot evade the server-wide limit", async () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      jar.clear();
      expect((await call("POST", { pin: "000000" }, now)).status).toBe(401);
    }
    jar.clear();
    expect((await call("POST", { pin: "123456" }, now)).status).toBe(429);
    expect((await call("POST", { pin: "123456" }, now + 300_000)).status).toBe(
      200,
    );
  });
});
