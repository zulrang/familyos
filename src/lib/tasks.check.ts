import assert from "node:assert/strict";
import { sortByPosition, splitLeadingEmoji } from "./list-text.ts";

assert.deepEqual(splitLeadingEmoji("Eggs"), { label: "Eggs" });
assert.deepEqual(splitLeadingEmoji("🥚 Eggs"), {
  emoji: "🥚",
  label: "Eggs",
});
assert.deepEqual(splitLeadingEmoji("🥚Eggs"), {
  emoji: "🥚",
  label: "Eggs",
});
assert.deepEqual(splitLeadingEmoji("🥚"), { label: "🥚" });
assert.deepEqual(splitLeadingEmoji("🇯🇵 Japan"), {
  emoji: "🇯🇵",
  label: "Japan",
});
assert.deepEqual(splitLeadingEmoji("  Apples  "), { label: "Apples" });
assert.deepEqual(splitLeadingEmoji("Towel x2"), { label: "Towel x2" });

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

console.log("tasks.check ok");
