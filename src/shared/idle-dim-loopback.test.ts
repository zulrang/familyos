import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "vitest";
import { IDLE_DIM_APPLY_URL } from "@/shared/idle-dim";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../kiosk/idle-dim",
);

const ALLOWED_ORIGIN = "http://familyos.test:3000";

let child: ChildProcess | undefined;
let runtime: string | undefined;

afterEach(async () => {
  if (child?.pid) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 50));
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  child = undefined;
});

async function writeFakeBin(dir: string, name: string, body: string) {
  const file = path.join(dir, name);
  await writeFile(file, `#!/bin/bash\n${body}\n`);
  await chmod(file, 0o755);
}

async function startIdleDim(opts?: { idleMs?: string }) {
  runtime = await mkdtemp(path.join(tmpdir(), "idle-dim-"));
  const bin = path.join(runtime, "bin");
  await mkdir(bin, { recursive: true });
  await writeFakeBin(
    bin,
    "xprintidle",
    `cat "${runtime}/idle" 2>/dev/null || echo 0`,
  );
  await writeFakeBin(
    bin,
    "ddcutil",
    `
echo "$@" >> "${runtime}/ddcutil.log"
if [ "$3" = getvcp ]; then
  echo "VCP 10 C 50"
fi
exit 0
`,
  );
  await writeFile(path.join(runtime, "idle"), opts?.idleMs ?? "0");

  child = spawn(SCRIPT, [], {
    cwd: runtime,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      XDG_RUNTIME_DIR: runtime,
      DISPLAY: ":0",
    },
    detached: true,
    stdio: "ignore",
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(IDLE_DIM_APPLY_URL, { method: "OPTIONS" });
      if (res.status) return runtime;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("idle-dim loopback listener did not start");
}

async function apply(body: unknown, origin = ALLOWED_ORIGIN) {
  return fetch(IDLE_DIM_APPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

function cfgPath() {
  return path.join(runtime ?? "", "familyos-idle-dim.cfg");
}

describe("Idle Dim loopback apply", () => {
  test("POST stores last-good timeout and dim-to", async () => {
    await startIdleDim();
    const res = await apply({ idleDimAfterMs: 120_000, idleDimTo: 20 });
    assert.equal(res.status, 204);
    const cfg = await readFile(cfgPath(), "utf8");
    assert.equal(cfg.trim(), "120000\n20");
  });

  test("illegal apply leaves last-good unchanged", async () => {
    await startIdleDim();
    assert.equal(
      (await apply({ idleDimAfterMs: 120_000, idleDimTo: 20 })).status,
      204,
    );
    assert.equal(
      (await apply({ idleDimAfterMs: 45_000, idleDimTo: 15 })).status,
      400,
    );
    assert.equal(
      (await apply({ idleDimAfterMs: "30000", idleDimTo: 20 })).status,
      400,
    );
    assert.equal(
      (await apply({ idleDimAfterMs: "120000", idleDimTo: 0 })).status,
      400,
    );
    const cfg = await readFile(cfgPath(), "utf8");
    assert.equal(cfg.trim(), "120000\n20");
  });

  test("a new dim-to while already dimmed is sent to the panel", async () => {
    const dir = await startIdleDim();
    await writeFile(path.join(dir, "familyos-idle-dim.saved"), "50");
    assert.equal(
      (await apply({ idleDimAfterMs: 300_000, idleDimTo: 20 })).status,
      204,
    );
    const log = await readFile(path.join(dir, "ddcutil.log"), "utf8");
    assert.match(log, /setvcp 10 20/);
  });

  test("the listener is not reachable on the LAN", async () => {
    await startIdleDim();
    const locals = Object.values(networkInterfaces()).flatMap((nets) =>
      (nets ?? []).filter((n) => n.family === "IPv4" && !n.internal),
    );
    for (const n of locals) {
      await assert.rejects(
        fetch(`http://${n.address}:7380/idle-dim`, {
          method: "OPTIONS",
          signal: AbortSignal.timeout(400),
        }),
      );
    }
  });
});
