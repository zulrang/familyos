/**
 * HTTP acceptance seam for per-Display UI scale (#4).
 * Isolated data dir; no live Google credentials.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-scale-"));
process.env.FAMILYOS_DATA_DIR = dataRoot;

const { writeSettings, readSettings } = await import("./settings.ts");
const { emitStartupPairingCode, DISPLAY_COOKIE, createPairingCode } =
  await import("./pairing.ts");
const { handlePair } = await import("./pairing-http.ts");
const { handleGetSettings, handlePatchSettings } = await import(
  "./settings-http.ts"
);

await mkdir(dataRoot, { recursive: true });
await writeSettings({
  familyName: "ScaleHousehold",
  members: [],
  calendarId: null,
  calendarTimeZone: null,
  tokens: null,
  oauthState: null,
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

async function pairWithCode(code: string): Promise<{
  cookie: string;
  displayId: string;
}> {
  const res = await handlePair(
    new Request("http://familyos.test/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { displayId: string };
  const cookie = cookieFrom(res);
  assert.ok(cookie);
  return { cookie, displayId: body.displayId };
}

async function getSettings(cookie: string) {
  const res = await handleGetSettings(
    new Request("http://familyos.test/api/settings", {
      headers: { cookie },
    }),
  );
  assert.equal(res.status, 200);
  return (await res.json()) as {
    familyName: string;
    uiScale: number;
  };
}

async function patchSettings(cookie: string, body: Record<string, unknown>) {
  return handlePatchSettings(
    new Request("http://familyos.test/api/settings", {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const startupCode = await emitStartupPairingCode();
assert.ok(startupCode);
const first = await pairWithCode(startupCode);
const { code: secondCode } = await createPairingCode();
const second = await pairWithCode(secondCode);

// --- New Displays default to 100% ---
{
  const a = await getSettings(first.cookie);
  const b = await getSettings(second.cookie);
  assert.equal(a.uiScale, 1);
  assert.equal(b.uiScale, 1);
  assert.equal(a.familyName, "ScaleHousehold");
}

// --- Two Displays keep independent scales; reload (GET) preserves them ---
{
  const setA = await patchSettings(first.cookie, { uiScale: 1.5 });
  assert.equal(setA.status, 200);
  assert.equal(((await setA.json()) as { uiScale: number }).uiScale, 1.5);

  const setB = await patchSettings(second.cookie, { uiScale: 1.25 });
  assert.equal(setB.status, 200);
  assert.equal(((await setB.json()) as { uiScale: number }).uiScale, 1.25);

  assert.equal((await getSettings(first.cookie)).uiScale, 1.5);
  assert.equal((await getSettings(second.cookie)).uiScale, 1.25);
}

// --- Changing scale does not mutate Household Configuration ---
{
  const before = await readFile(path.join(dataRoot, "kiosk.json"), "utf8");
  const householdBefore = await readSettings();
  assert.equal("uiScale" in householdBefore, false);

  const res = await patchSettings(first.cookie, { uiScale: 1.1 });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { uiScale: number }).uiScale, 1.1);

  const after = await readFile(path.join(dataRoot, "kiosk.json"), "utf8");
  assert.equal(after, before);
  assert.equal((await getSettings(second.cookie)).uiScale, 1.25);
}

// --- Household field patch leaves each Display's scale alone ---
{
  const res = await patchSettings(first.cookie, {
    familyName: "RenamedHousehold",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { familyName: string; uiScale: number };
  assert.equal(body.familyName, "RenamedHousehold");
  assert.equal(body.uiScale, 1.1);
  assert.equal((await getSettings(second.cookie)).uiScale, 1.25);
  assert.equal(
    (await getSettings(second.cookie)).familyName,
    "RenamedHousehold",
  );
}

// --- Invalid scale values are normalized; previous scale kept as fallback ---
{
  const res = await patchSettings(first.cookie, { uiScale: 9 });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { uiScale: number }).uiScale, 1.1);

  const badType = await patchSettings(second.cookie, { uiScale: "1.5" });
  assert.equal(badType.status, 200);
  assert.equal(((await badType.json()) as { uiScale: number }).uiScale, 1.25);
}

await rm(dataRoot, { recursive: true, force: true });
console.log("settings-http.check ok");
