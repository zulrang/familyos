/**
 * HTTP acceptance seam for Trusted Display management (#3).
 * Isolated data dir; no live Google credentials.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

test("displays http", async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-displays-"));
  process.env.FAMILYOS_DATA_DIR = dataRoot;

  const { emitStartupPairingCode, DISPLAY_COOKIE } = await import(
    "./pairing.ts"
  );
  const { handleListDisplays, handleCreatePairingCode, handleRevokeDisplay } =
    await import("./displays-http.ts");
  const { handlePair, handleReady } = await import("./pairing-http.ts");
  const { requireTrustedDisplay } = await import("./display-auth.ts");

  await mkdir(dataRoot, { recursive: true });

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

  async function mintCode(cookie: string): Promise<string> {
    const res = await handleCreatePairingCode(
      new Request("http://familyos.test/api/displays/pairing-code", {
        method: "POST",
        headers: { cookie },
      }),
    );
    assert.equal(res.status, 200);
    return ((await res.json()) as { code: string }).code;
  }

  // --- Unpaired cannot list Displays ---
  {
    const denied = await handleListDisplays(
      new Request("http://familyos.test/api/displays"),
    );
    assert.equal(denied.status, 401);
  }

  const startupCode = await emitStartupPairingCode();
  assert.ok(startupCode);
  const first = await pairWithCode(startupCode);

  // --- Trusted Display can list; no credentials or secrets ---
  {
    const res = await handleListDisplays(
      new Request("http://familyos.test/api/displays", {
        headers: { cookie: first.cookie },
      }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      displays: Array<Record<string, unknown>>;
      currentDisplayId: string;
    };
    assert.equal(body.currentDisplayId, first.displayId);
    assert.equal(body.displays.length, 1);
    assert.equal(body.displays[0]?.id, first.displayId);
    assert.equal(typeof body.displays[0]?.createdAt, "number");
    assert.equal(body.displays[0]?.revokedAt, null);
    const text = JSON.stringify(body);
    assert.equal(text.includes("credential"), false);
    assert.equal(text.includes("Hash"), false);
    assert.equal(text.includes("token"), false);
    assert.equal(text.includes(first.cookie.split("=")[1] ?? "___"), false);
  }

  // --- Unpaired cannot mint a pairing code ---
  {
    const denied = await handleCreatePairingCode(
      new Request("http://familyos.test/api/displays/pairing-code", {
        method: "POST",
      }),
    );
    assert.equal(denied.status, 401);
  }

  // --- Trusted Display mints a short-lived code; expires and cannot be reused ---
  const minted = await handleCreatePairingCode(
    new Request("http://familyos.test/api/displays/pairing-code", {
      method: "POST",
      headers: { cookie: first.cookie },
    }),
  );
  assert.equal(minted.status, 200);
  const { code, expiresAt } = (await minted.json()) as {
    code: string;
    expiresAt: number;
  };
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.ok(expiresAt > Date.now());
  assert.ok(expiresAt <= Date.now() + 10 * 60 * 1000 + 1000);

  const second = await pairWithCode(code);

  {
    const reuse = await handlePair(
      new Request("http://familyos.test/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }),
    );
    assert.equal(reuse.status, 403);
    assert.equal(((await reuse.json()) as { error: string }).error, "reused");
  }

  // Equal authority: second Display can also mint.
  const fromSecondCode = await mintCode(second.cookie);

  {
    const file = path.join(dataRoot, "displays.json");
    const store = JSON.parse(await readFile(file, "utf8")) as {
      pendingCode: {
        code: string;
        expiresAt: number;
        consumedAt: number | null;
      } | null;
    };
    assert.equal(store.pendingCode?.code, fromSecondCode);
    store.pendingCode = {
      code: fromSecondCode,
      expiresAt: Date.now() - 1,
      consumedAt: null,
    };
    await writeFile(file, `${JSON.stringify(store, null, 2)}\n`);
    const expired = await handlePair(
      new Request("http://familyos.test/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: fromSecondCode }),
      }),
    );
    assert.equal(expired.status, 403);
    assert.equal(
      ((await expired.json()) as { error: string }).error,
      "expired",
    );
  }

  // --- Unpaired cannot revoke ---
  {
    const denied = await handleRevokeDisplay(
      new Request("http://familyos.test/api/displays/x", { method: "DELETE" }),
      first.displayId,
    );
    assert.equal(denied.status, 401);
  }

  // Pair a third Display whose credential we will revoke
  const third = await pairWithCode(await mintCode(first.cookie));

  // --- Revocation immediately rejects the credential ---
  {
    const revoked = await handleRevokeDisplay(
      new Request(`http://familyos.test/api/displays/${third.displayId}`, {
        method: "DELETE",
        headers: { cookie: first.cookie },
      }),
      third.displayId,
    );
    assert.equal(revoked.status, 200);

    const denied = await requireTrustedDisplay(
      new Request("http://familyos.test/api/settings", {
        headers: { cookie: third.cookie },
      }),
    );
    assert.ok(denied instanceof Response);
    assert.equal(denied.status, 401);

    const ready = await handleReady(
      new Request("http://familyos.test/api/ready", {
        headers: { cookie: third.cookie },
      }),
    );
    assert.equal(((await ready.json()) as { paired: boolean }).paired, false);

    const after = await handleListDisplays(
      new Request("http://familyos.test/api/displays", {
        headers: { cookie: first.cookie },
      }),
    );
    const afterBody = (await after.json()) as {
      displays: Array<{ id: string }>;
    };
    assert.equal(
      afterBody.displays.some((d) => d.id === third.displayId),
      false,
    );
    assert.equal(JSON.stringify(afterBody).includes("credential"), false);
  }

  // --- Equal authority: second Display can revoke the first ---
  {
    const revoked = await handleRevokeDisplay(
      new Request(`http://familyos.test/api/displays/${first.displayId}`, {
        method: "DELETE",
        headers: { cookie: second.cookie },
      }),
      first.displayId,
    );
    assert.equal(revoked.status, 200);

    const denied = await requireTrustedDisplay(
      new Request("http://familyos.test/api/settings", {
        headers: { cookie: first.cookie },
      }),
    );
    assert.ok(denied instanceof Response);
    assert.equal(denied.status, 401);
  }

  await rm(dataRoot, { recursive: true, force: true });
});
