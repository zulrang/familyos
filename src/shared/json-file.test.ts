import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import { withFileQueue, writeAtomicJson } from "./json-file";

describe("shared JSON file helpers", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "familyos-json-file-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("writeAtomicJson writes valid JSON with optional 0o600 mode and leaves no temp files", async () => {
    const file = path.join(dir, "nested", "secret.json");
    await writeAtomicJson(
      file,
      { token: "abc", count: 2 },
      { mode: 0o600, pretty: true },
    );

    const raw = await readFile(file, "utf8");
    assert.deepEqual(JSON.parse(raw), { token: "abc", count: 2 });
    assert.equal(raw.endsWith("\n"), true);
    assert.equal(raw.includes("\n  "), true);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.dirname(file)), ["secret.json"]);
  });

  test("writeAtomicJson removes its temp file when rename fails", async () => {
    const blockedDir = path.join(dir, "blocked");
    const target = path.join(blockedDir, "store.json");
    await writeAtomicJson(target, { ok: true });
    await chmod(blockedDir, 0o555);
    try {
      await assert.rejects(() => writeAtomicJson(target, { ok: false }));
    } finally {
      await chmod(blockedDir, 0o755);
    }
    assert.deepEqual(await readdir(blockedDir), ["store.json"]);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { ok: true });
  });

  test("withFileQueue serializes concurrent ops on the same path and recovers from errors", async () => {
    const target = path.join(dir, "counter.json");
    await writeFile(target, JSON.stringify({ n: 0 }));

    const increment = () =>
      withFileQueue(target, async () => {
        const cur = JSON.parse(await readFile(target, "utf8")) as { n: number };
        await new Promise((r) => setTimeout(r, 5));
        await writeAtomicJson(target, { n: cur.n + 1 });
        return cur.n + 1;
      });

    const failing = withFileQueue(target, async () => {
      throw new Error("boom");
    });

    const results = await Promise.allSettled([
      increment(),
      failing,
      increment(),
      increment(),
    ]);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(results[1]?.status, "rejected");
    assert.equal(results[2]?.status, "fulfilled");
    assert.equal(results[3]?.status, "fulfilled");
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { n: 3 });
  });

  test("withFileQueue runs operations on distinct file paths concurrently", async () => {
    const fileA = path.join(dir, "a.json");
    const fileB = path.join(dir, "b.json");
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const opA = withFileQueue(fileA, () => gateA);
    const opB = withFileQueue(fileB, async () => "b-done");

    assert.equal(await opB, "b-done");
    releaseA();
    await opA;
  });
});
