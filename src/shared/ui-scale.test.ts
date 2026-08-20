import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parseUiScale, UI_SCALES } from "@/shared/ui-scale";

describe("UI scale", () => {
  test("exposes the four allowed scale steps", () => {
    assert.deepEqual([...UI_SCALES], [1, 1.1, 1.25, 1.5]);
  });

  test("accepts each allowed scale value", () => {
    assert.equal(parseUiScale(1), 1);
    assert.equal(parseUiScale(1.1), 1.1);
    assert.equal(parseUiScale(1.25), 1.25);
    assert.equal(parseUiScale(1.5), 1.5);
  });

  test("falls back to 100% for missing or invalid values", () => {
    assert.equal(parseUiScale(undefined), 1);
    assert.equal(parseUiScale(null), 1);
    assert.equal(parseUiScale(2), 1);
    assert.equal(parseUiScale("1.25"), 1);
  });

  test("uses the previous scale as fallback when the value is invalid", () => {
    assert.equal(parseUiScale(1.25, 1.1), 1.25);
    assert.equal(parseUiScale(9, 1.5), 1.5);
  });
});
