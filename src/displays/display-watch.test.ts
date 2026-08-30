import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { displayWatchAction, parseReadySnapshot } from "./display-watch";

describe("Display readiness watch", () => {
  test("a new BUILD_ID reloads the Display", () => {
    const first = parseReadySnapshot({
      ready: true,
      paired: true,
      buildId: "build-a",
    });
    assert.ok(first);
    const stay = displayWatchAction(null, first);
    assert.equal(stay.kind, "none");
    if (stay.kind !== "none") return;

    const second = parseReadySnapshot({
      ready: true,
      paired: true,
      buildId: "build-b",
    });
    assert.ok(second);
    const action = displayWatchAction(stay.buildId, second);
    assert.equal(action.kind, "reload");
  });

  test("the same BUILD_ID does not reload", () => {
    const ready = parseReadySnapshot({
      ready: true,
      paired: true,
      buildId: "build-a",
    });
    assert.ok(ready);
    const stay = displayWatchAction(null, ready);
    assert.equal(stay.kind, "none");
    if (stay.kind !== "none") return;
    assert.equal(displayWatchAction(stay.buildId, ready).kind, "none");
  });

  test("an unpaired Display returns to pairing", () => {
    const ready = parseReadySnapshot({
      ready: true,
      paired: false,
      buildId: "build-a",
    });
    assert.ok(ready);
    assert.equal(displayWatchAction("build-a", ready).kind, "pairing");
  });

  test("a missing BUILD_ID does not reload", () => {
    const ready = parseReadySnapshot({ ready: true, paired: true });
    assert.ok(ready);
    const stay = displayWatchAction(null, ready);
    assert.equal(stay.kind, "none");
    if (stay.kind !== "none") return;
    assert.equal(stay.buildId, null);
    assert.equal(displayWatchAction(stay.buildId, ready).kind, "none");
  });
});
