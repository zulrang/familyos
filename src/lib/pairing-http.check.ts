/**
 * HTTP acceptance seam for Display pairing (#2).
 * Isolated data dir; no live Google credentials.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-pair-"));
process.env.FAMILYOS_DATA_DIR = dataRoot;

const { writeHousehold } = await import("./settings.ts");
const { writeProvider } = await import("./provider.ts");
const { emitStartupPairingCode, DISPLAY_COOKIE } = await import("./pairing.ts");
const { requireTrustedDisplay } = await import("./display-auth.ts");
const { handleReady, handlePair } = await import("./pairing-http.ts");

await mkdir(dataRoot, { recursive: true });
await writeHousehold({
  familyName: "SecretHousehold",
  members: [
    {
      id: "m_secret",
      name: "SecretMember",
      status: "active",
      color: "#a9d8d2",
    },
  ],
  calendarId: "secret-cal@group.calendar.google.com",
  calendarTimeZone: "America/New_York",
  listIds: [],
  configVersion: 1,
});
await writeProvider({
  tokens: {
    access_token: "secret-access",
    refresh_token: "secret-refresh",
    expiry: Date.now() + 60_000,
  },
  oauthState: null,
  providerConnectionId: "conn-secret",
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

async function patchPendingCode(pending: {
  code: string;
  expiresAt: number;
  consumedAt: number | null;
}) {
  const file = path.join(dataRoot, "displays.json");
  const store = JSON.parse(await readFile(file, "utf8")) as {
    pendingCode: unknown;
    displays: unknown[];
  };
  store.pendingCode = pending;
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`);
}

// --- Unpaired: readiness only, no household leak ---
{
  const res = await handleReady(new Request("http://familyos.test/api/ready"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ready, true);
  assert.equal(body.paired, false);
  const text = JSON.stringify(body);
  assert.equal(text.includes("SecretHousehold"), false);
  assert.equal(text.includes("SecretMember"), false);
  assert.equal(text.includes("secret-cal"), false);
  assert.equal(text.includes("secret-access"), false);
  assert.equal(text.includes("signedIn"), false);
  assert.equal(text.includes("googleConfigured"), false);
  assert.equal(text.includes("members"), false);
}

// --- Unpaired: household API gate ---
{
  const denied = await requireTrustedDisplay(
    new Request("http://familyos.test/api/settings"),
  );
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 401);
  const body = (await denied.json()) as Record<string, unknown>;
  assert.equal(JSON.stringify(body).includes("SecretHousehold"), false);
}

// --- Fresh startup emits one short-lived code; pairs once ---
const code = await emitStartupPairingCode();
assert.ok(code);
assert.match(code, /^[A-Z2-9]{6}$/);

{
  const res = await handlePair(
    new Request("http://familyos.test/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; displayId: string };
  assert.equal(body.ok, true);
  assert.ok(body.displayId);
  const cookie = cookieFrom(res);
  assert.ok(cookie?.startsWith(`${DISPLAY_COOKIE}=`));

  const reuse = await handlePair(
    new Request("http://familyos.test/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
  assert.equal(reuse.status, 403);
  assert.equal(((await reuse.json()) as { error: string }).error, "reused");

  const ready = await handleReady(
    new Request("http://familyos.test/api/ready", {
      headers: { cookie },
    }),
  );
  assert.equal(((await ready.json()) as { paired: boolean }).paired, true);

  const allowed = await requireTrustedDisplay(
    new Request("http://familyos.test/api/settings", {
      headers: { cookie },
    }),
  );
  assert.ok(!(allowed instanceof Response));
  assert.equal(allowed.id, body.displayId);

  // Later startups do not mint another installer code once a Display exists.
  assert.equal(await emitStartupPairingCode(), null);
}

// --- Expired code fails ---
{
  await patchPendingCode({
    code: "EXPIRE",
    expiresAt: Date.now() - 1,
    consumedAt: null,
  });
  const res = await handlePair(
    new Request("http://familyos.test/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "EXPIRE" }),
    }),
  );
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, "expired");
}

// --- Invalid code fails ---
{
  await patchPendingCode({
    code: "VALID1",
    expiresAt: Date.now() + 60_000,
    consumedAt: null,
  });
  const res = await handlePair(
    new Request("http://familyos.test/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "NOPE00" }),
    }),
  );
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, "invalid");
}

await rm(dataRoot, { recursive: true, force: true });
console.log("pairing-http.check ok");
