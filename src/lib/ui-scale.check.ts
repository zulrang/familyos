import assert from "node:assert/strict";
import { parseUiScale, UI_SCALES } from "./types.ts";

assert.deepEqual([...UI_SCALES], [1, 1.1, 1.25, 1.5]);

assert.equal(parseUiScale(1), 1);
assert.equal(parseUiScale(1.1), 1.1);
assert.equal(parseUiScale(1.25), 1.25);
assert.equal(parseUiScale(1.5), 1.5);

assert.equal(parseUiScale(undefined), 1);
assert.equal(parseUiScale(null), 1);
assert.equal(parseUiScale(2), 1);
assert.equal(parseUiScale("1.25"), 1);
assert.equal(parseUiScale(1.25, 1.1), 1.25);
assert.equal(parseUiScale(9, 1.5), 1.5);

console.log("ui-scale.check ok");
