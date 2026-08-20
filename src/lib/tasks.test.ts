import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sortByPosition, splitLeadingEmoji } from "./list-text.ts";

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
