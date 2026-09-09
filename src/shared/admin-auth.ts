import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./data-path";

export const ADMIN_IDLE_MS = 15 * 60_000;
const COOLDOWN_MS = 5 * 60_000;
const SESSION_COOKIE = "familyos_admin";
const DEVICE_COOKIE = "familyos_admin_device";
let cached: { dir: string; db: DatabaseSync } | undefined;

function database() {
  const dir = dataDir();
  if (cached?.dir === dir) return cached.db;
  cached?.db.close();
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "admin.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, pin_version TEXT NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS failures (device TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS failures_at ON failures(at);
    CREATE TABLE IF NOT EXISTS cooldowns (scope TEXT PRIMARY KEY, until_at INTEGER NOT NULL);
  `);
  cached = { dir, db };
  return db;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function configuredPin() {
  const pin = process.env.FAMILYOS_ADMIN_PIN;
  return pin && /^\d{6}$/.test(pin) ? pin : null;
}

function cookieValue(request: Request, name: string) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function cookie(name: string, value: string, maxAge: number) {
  // The household explicitly uses HTTP. HttpOnly keeps credentials out of JS.
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function adminJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function adminWriteAllowed(request: Request) {
  const url = new URL(request.url);
  // Next constructs Request.url with its internal hostname. The browser's
  // actual origin is the direct LAN Host header, not a forwarded header.
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  return (
    request.headers.get("origin") === origin &&
    request.headers.get("x-familyos-admin") === "1"
  );
}

function session(request: Request, now: number) {
  const pin = configuredPin();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!pin || !token) return null;
  const row = database()
    .prepare(
      "SELECT last_seen FROM sessions WHERE token = ? AND pin_version = ? AND last_seen > ?",
    )
    .get(digest(token), digest(pin), now - ADMIN_IDLE_MS);
  return row ? { token: digest(token), lastSeen: Number(row.last_seen) } : null;
}

/** Every admin data endpoint checks the server-side expiry, including reads. */
export function requireAdmin(request: Request): Response | null {
  if (request.method !== "GET" && !adminWriteAllowed(request)) {
    return adminJson(
      { error: "Request must come from this admin interface." },
      403,
    );
  }
  return session(request, Date.now())
    ? null
    : adminJson({ error: "Enter your PIN to continue." }, 401);
}

export async function handleAdminSession(
  request: Request,
  now = Date.now(),
): Promise<Response> {
  const pin = configuredPin();
  if (!pin)
    return adminJson(
      {
        status: "disabled",
        error: "Parent admin is not configured on this server.",
      },
      503,
    );
  const db = database();
  db.prepare(
    "DELETE FROM sessions WHERE last_seen <= ? OR pin_version != ?",
  ).run(now - ADMIN_IDLE_MS, digest(pin));
  db.prepare("DELETE FROM failures WHERE at <= ?").run(now - COOLDOWN_MS);
  db.prepare("DELETE FROM cooldowns WHERE until_at <= ?").run(now);
  const existingDevice = cookieValue(request, DEVICE_COOKIE);
  const device = existingDevice ?? randomBytes(32).toString("hex");
  const finish = (response: Response) => {
    if (!existingDevice)
      response.headers.append(
        "Set-Cookie",
        cookie(DEVICE_COOKIE, device, 31536000),
      );
    return response;
  };
  if (request.method === "GET") {
    const current = session(request, now);
    return finish(
      adminJson(
        current
          ? { status: "unlocked", expiresAt: current.lastSeen + ADMIN_IDLE_MS }
          : { status: "locked" },
      ),
    );
  }
  if (!adminWriteAllowed(request))
    return finish(
      adminJson({ error: "Request must come from this admin interface." }, 403),
    );
  if (request.method === "DELETE") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token = ?").run(digest(token));
    const response = adminJson({ status: "locked" });
    response.headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
    return finish(response);
  }
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object")
    return finish(adminJson({ error: "Invalid request." }, 400));
  if ("activity" in raw && raw.activity === true) {
    const current = session(request, now);
    if (!current)
      return finish(adminJson({ error: "Enter your PIN to continue." }, 401));
    db.prepare("UPDATE sessions SET last_seen = ? WHERE token = ?").run(
      now,
      current.token,
    );
    return finish(
      adminJson({ status: "unlocked", expiresAt: now + ADMIN_IDLE_MS }),
    );
  }
  // Both counts are persisted; clearing a device cookie cannot bypass the global limit.
  const failures = db
    .prepare("SELECT device, at FROM failures ORDER BY at")
    .all();
  const deviceFailures = failures.filter(
    (row) => row.device === digest(device),
  );
  const blocked = db
    .prepare(
      "SELECT MAX(until_at) AS until_at FROM cooldowns WHERE scope IN (?, ?) AND until_at > ?",
    )
    .get(digest(device), "global", now)?.until_at;
  if (blocked) {
    const retryAfter = Math.max(1, Math.ceil((Number(blocked) - now) / 1000));
    const response = adminJson(
      { error: "Too many attempts. Try again in five minutes.", retryAfter },
      429,
    );
    response.headers.set("Retry-After", String(retryAfter));
    return finish(response);
  }
  const candidate = "pin" in raw && typeof raw.pin === "string" ? raw.pin : "";
  if (
    !timingSafeEqual(Buffer.from(digest(candidate)), Buffer.from(digest(pin)))
  ) {
    db.prepare("INSERT INTO failures (device, at) VALUES (?, ?)").run(
      digest(device),
      now,
    );
    if (deviceFailures.length >= 4)
      db.prepare(
        "INSERT OR REPLACE INTO cooldowns (scope, until_at) VALUES (?, ?)",
      ).run(digest(device), now + COOLDOWN_MS);
    if (failures.length >= 49)
      db.prepare(
        "INSERT OR REPLACE INTO cooldowns (scope, until_at) VALUES (?, ?)",
      ).run("global", now + COOLDOWN_MS);
    return finish(adminJson({ error: "Incorrect PIN." }, 401));
  }
  db.prepare("DELETE FROM failures WHERE device = ?").run(digest(device));
  const oldToken = cookieValue(request, SESSION_COOKIE);
  if (oldToken)
    db.prepare("DELETE FROM sessions WHERE token = ?").run(digest(oldToken));
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token, pin_version, last_seen) VALUES (?, ?, ?)",
  ).run(digest(token), digest(pin), now);
  const response = adminJson({
    status: "unlocked",
    expiresAt: now + ADMIN_IDLE_MS,
  });
  response.headers.append(
    "Set-Cookie",
    cookie(SESSION_COOKIE, token, 31536000),
  );
  return finish(response);
}
