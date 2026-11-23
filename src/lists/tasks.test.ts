import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, test, vi } from "vitest";
import { sortByPosition, splitLeadingEmoji } from "./list-text";
import { listSelectedListsWithItems } from "./tasks";

describe("List Item text", () => {
  test("leaves plain titles unchanged", () => {
    assert.deepEqual(splitLeadingEmoji("Eggs"), { label: "Eggs" });
    assert.deepEqual(splitLeadingEmoji("  Apples  "), { label: "Apples" });
    assert.deepEqual(splitLeadingEmoji("Towel x2"), { label: "Towel x2" });
  });

  test("splits a leading emoji from the label", () => {
    assert.deepEqual(splitLeadingEmoji("🥚 Eggs"), {
      emoji: "🥚",
      label: "Eggs",
    });
    assert.deepEqual(splitLeadingEmoji("🥚Eggs"), {
      emoji: "🥚",
      label: "Eggs",
    });
    assert.deepEqual(splitLeadingEmoji("🇯🇵 Japan"), {
      emoji: "🇯🇵",
      label: "Japan",
    });
  });

  test("treats emoji-only titles as the label", () => {
    assert.deepEqual(splitLeadingEmoji("🥚"), { label: "🥚" });
  });

  test("sorts List Items by provider position", () => {
    const ordered = sortByPosition([
      { id: "c", position: "00000000000000000002" },
      { id: "a", position: "00000000000000000000" },
      { id: "b", position: "00000000000000000001" },
    ]);
    assert.deepEqual(
      ordered.map((x) => x.id),
      ["a", "b", "c"],
    );
    assert.deepEqual(
      sortByPosition([{ id: "x", position: "" }]).map((x) => x.id),
      ["x"],
    );
  });
});

describe("listSelectedListsWithItems", () => {
  let dataRoot: string;
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-lists-tasks-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;
    await mkdir(dataRoot, { recursive: true });
    const { writeProvider } = await import("@/shared/provider");
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 600_000,
      },
      oauthState: null,
      providerConnectionId: "acct-1",
    });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test("fetches selected lists concurrently, preserves order, and skips missing lists", async () => {
    let releaseL1!: (res: Response) => void;
    let releaseL2!: (res: Response) => void;
    const requestedMeta: string[] = [];

    globalThis.fetch = (input) => {
      const url = String(input);
      if (url.endsWith("/users/@me/lists/l1")) {
        requestedMeta.push("l1");
        return new Promise<Response>((resolve) => {
          releaseL1 = resolve;
        });
      }
      if (url.endsWith("/users/@me/lists/l2")) {
        requestedMeta.push("l2");
        return new Promise<Response>((resolve) => {
          releaseL2 = resolve;
        });
      }
      if (url.endsWith("/users/@me/lists/l-gone")) {
        requestedMeta.push("l-gone");
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (url.includes("/lists/l1/tasks")) {
        return Promise.resolve(
          Response.json({
            items: [
              { id: "i1", title: "Milk", status: "needsAction", etag: "e1" },
            ],
          }),
        );
      }
      if (url.includes("/lists/l2/tasks")) {
        return Promise.resolve(
          Response.json({
            items: [
              { id: "i2", title: "Soap", status: "completed", etag: "e2" },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const pending = listSelectedListsWithItems(["l1", "l-gone", "l2"]);
    await vi.waitFor(() => {
      assert.deepEqual([...requestedMeta].sort(), ["l-gone", "l1", "l2"]);
    });

    releaseL2(Response.json({ id: "l2", title: "Second" }));
    releaseL1(Response.json({ id: "l1", title: "First" }));

    const result = await pending;
    assert.deepEqual(
      result.map((l) => ({ id: l.id, title: l.title, count: l.items.length })),
      [
        { id: "l1", title: "First", count: 1 },
        { id: "l2", title: "Second", count: 1 },
      ],
    );
    assert.equal(result[0]?.items[0]?.title, "Milk");
    assert.equal(result[1]?.items[0]?.title, "Soap");
  });
});
