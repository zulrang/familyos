/**
 * Member roster domain seam (#6) and Member Color surfaces (#20).
 * Pure parse/validate/retire/paint — no HTTP, no Settings UI.
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  activeMembers,
  MAX_ACTIVE_MEMBERS,
  memberById,
  memberSurface,
  migrateRoster,
  onFillInk,
  parseMemberColor,
  parseRoster,
  resolveMembers,
  retireMember,
} from "./members";

describe("Household Members", () => {
  test("caps Active Members at six", () => {
    assert.equal(MAX_ACTIVE_MEMBERS, 6);
  });

  test("Member Color is open #rrggbb, normalized, independent of Google", () => {
    assert.equal(parseMemberColor("#A9D8D2"), "#a9d8d2");
    assert.equal(parseMemberColor("#a9d8d2"), "#a9d8d2");
    assert.equal(parseMemberColor("a9d8d2"), null);
    assert.equal(parseMemberColor("#fff"), null);
    assert.equal(parseMemberColor("#gg0000"), null);
    assert.equal(parseMemberColor(null), null);
  });

  test("accepts an empty roster", () => {
    const r = parseRoster([]);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.members, []);
  });

  test("accepts six Active Members with unique colors", () => {
    const colors = [
      "#a9d8d2",
      "#f6c9c5",
      "#dccfea",
      "#c8e5cd",
      "#f9c0bc",
      "#f7e3c8",
    ];
    const raw = colors.map((color, i) => ({
      id: `m${i}`,
      name: `Person ${i}`,
      status: "active",
      color,
    }));
    const r = parseRoster(raw);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.members.length, 6);
      assert.equal(activeMembers(r.members).length, 6);
    }
  });

  test("rejects a seventh Active Member", () => {
    const raw = Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      name: `P${i}`,
      status: "active",
      color: `#${(0x100000 + i).toString(16).padStart(6, "0")}`,
    }));
    const r = parseRoster(raw);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "too_many_active");
  });

  test("rejects duplicate Active Member Colors case-insensitively", () => {
    const r = parseRoster([
      { id: "a", name: "Ada", status: "active", color: "#A9D8D2" },
      { id: "b", name: "Ben", status: "active", color: "#a9d8d2" },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "duplicate_active_color");
  });

  test("strips email so it is not part of the Member model", () => {
    const r = parseRoster([
      {
        id: "a",
        name: "Ada",
        status: "active",
        color: "#a9d8d2",
        email: "ada@example.com",
      },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.members.length, 1);
      assert.equal("email" in r.members[0], false);
      assert.deepEqual(r.members[0], {
        id: "a",
        name: "Ada",
        status: "active",
        color: "#a9d8d2",
      });
    }
  });

  test("migrates a legacy tone into a Member Color hex", () => {
    const r = parseRoster([
      { id: "a", name: "Ada", tone: "teal", email: "x@y.z" },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.members[0], {
        id: "a",
        name: "Ada",
        status: "active",
        color: "#a9d8d2",
      });
    }
  });

  test("retiring preserves id, frees color, and drops from Active", () => {
    const seeded = parseRoster([
      { id: "a", name: "Ada", status: "active", color: "#a9d8d2" },
      { id: "b", name: "Ben", status: "active", color: "#f6c9c5" },
    ]);
    assert.equal(seeded.ok, true);
    if (!seeded.ok) throw new Error("seed");
    const next = retireMember(seeded.members, "a");
    assert.ok(next);
    assert.deepEqual(memberById(next, "a"), {
      id: "a",
      name: "Ada",
      status: "retired",
    });
    assert.equal(
      activeMembers(next)
        .map((m) => m.id)
        .join(","),
      "b",
    );
    assert.equal("color" in (memberById(next, "a") ?? {}), false);

    const reused = parseRoster([
      ...next,
      { id: "c", name: "Cara", status: "active", color: "#a9d8d2" },
    ]);
    assert.equal(reused.ok, true);
    if (reused.ok) {
      assert.equal(activeMembers(reused.members).length, 2);
      assert.ok(memberById(reused.members, "a")?.status === "retired");
    }
  });

  test("Retired Members remain resolvable by stable ID", () => {
    const r = parseRoster([
      { id: "gone", name: "Old", status: "retired" },
      { id: "now", name: "New", status: "active", color: "#c8e5cd" },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(memberById(r.members, "gone")?.name, "Old");
      assert.equal(activeMembers(r.members).length, 1);
      assert.equal(activeMembers(r.members)[0].id, "now");
      assert.deepEqual(
        resolveMembers(r.members, ["gone", "now", "missing"]).map((m) => m.id),
        ["gone", "now"],
      );
    }
  });

  test("legacy roster migration keeps ids when Active constraints break", () => {
    const migrated = migrateRoster([
      { id: "a", name: "Ada", status: "active", color: "#a9d8d2" },
      { id: "b", name: "Ben", status: "active", color: "#a9d8d2" },
    ]);
    assert.equal(migrated.length, 2);
    assert.equal(memberById(migrated, "a")?.status, "active");
    assert.equal(memberById(migrated, "b")?.status, "retired");
  });

  test("rejects duplicate Member ids", () => {
    const r = parseRoster([
      { id: "a", name: "Ada", status: "active", color: "#a9d8d2" },
      { id: "a", name: "Other", status: "active", color: "#f6c9c5" },
    ]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "duplicate_id");
  });

  test("rejects invalid or missing color on an Active Member", () => {
    const bad = parseRoster([
      { id: "a", name: "Ada", status: "active", color: "teal" },
    ]);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error, "invalid_color");

    const missing = parseRoster([{ id: "a", name: "Ada", status: "active" }]);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "invalid_color");
  });

  test("Retired Members do not carry a Member Color", () => {
    const r = parseRoster([
      { id: "a", name: "Ada", status: "retired", color: "#a9d8d2" },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.members[0], {
        id: "a",
        name: "Ada",
        status: "retired",
      });
    }
  });

  test("palette Member Colors keep design-skill soft and ink", () => {
    assert.deepEqual(memberSurface("#a9d8d2"), {
      fill: "#a9d8d2",
      soft: "#d6ece9",
      ink: "#2c5d58",
    });
    assert.deepEqual(memberSurface("#f6c9c5"), {
      fill: "#f6c9c5",
      soft: "#fbe3e1",
      ink: "#7d413d",
    });
    assert.deepEqual(memberSurface("#dccfea"), {
      fill: "#dccfea",
      soft: "#efe8f5",
      ink: "#54406b",
    });
    assert.deepEqual(memberSurface("#c8e5cd"), {
      fill: "#c8e5cd",
      soft: "#e5f2e7",
      ink: "#3a6144",
    });
    assert.deepEqual(memberSurface("#f9c0bc"), {
      fill: "#f9c0bc",
      soft: "#fce0de",
      ink: "#8a4340",
    });
    assert.deepEqual(memberSurface("#f7e3c8"), {
      fill: "#f7e3c8",
      soft: "#fbf1e3",
      ink: "#7a5a2c",
    });
  });

  test("custom #rrggbb Member Colors get readable soft and ink", () => {
    // Mix fill with white 55% for soft, #1f2a33 72% for ink.
    assert.deepEqual(memberSurface("#4a90d9"), {
      fill: "#4a90d9",
      soft: "#aecdee",
      ink: "#2b4761",
    });
  });

  test("on-fill ink picks the higher-contrast of dark and white", () => {
    assert.equal(onFillInk("#a9d8d2"), "#1f2a33");
    assert.equal(onFillInk("#ffffff"), "#1f2a33");
    assert.equal(onFillInk("#4a90d9"), "#1f2a33");
    assert.equal(onFillInk("#5b9bd5"), "#1f2a33");
    assert.equal(onFillInk("#1a2744"), "#ffffff");
    assert.equal(onFillInk("#000000"), "#ffffff");
  });
});
