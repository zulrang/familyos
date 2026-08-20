/**
 * EventSheet Who selection — preserve Retired Member IDs (#7 / Bugbot).
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  applyWhoSelection,
  historicalParticipantIds,
  showSeveralOption,
  whoFromIds,
} from "./event-who.ts";
import type { Member } from "./types.ts";

const roster: Member[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "mom", name: "Mom", status: "active", color: "#f9c0bc" },
  { id: "ex", name: "Ex", status: "retired" },
];

describe("Event Participant selection", () => {
  test("derives selection mode from participant IDs", () => {
    assert.equal(whoFromIds([]), "none");
    assert.equal(whoFromIds(["dad"]), "dad");
    assert.equal(whoFromIds(["dad", "ex"]), "several");
  });

  test("identifies Retired Members still on the event", () => {
    assert.deepEqual(historicalParticipantIds(roster, ["dad", "ex"]), ["ex"]);
    assert.deepEqual(historicalParticipantIds(roster, ["dad"]), []);
  });

  test("picking one Active Member keeps Retired IDs and switches to several", () => {
    assert.deepEqual(applyWhoSelection("dad", roster, ["ex"]), {
      who: "several",
      memberIds: ["dad", "ex"],
    });
  });

  test("clearing participants yields a Household Event", () => {
    assert.deepEqual(applyWhoSelection("none", roster, ["dad", "ex"]), {
      who: "none",
      memberIds: [],
    });
  });

  test("multi-select keeps the current participant list", () => {
    assert.deepEqual(applyWhoSelection("several", roster, ["ex"]), {
      who: "several",
      memberIds: ["ex"],
    });
  });

  test("without historical IDs, a single Active pick replaces the list", () => {
    assert.deepEqual(applyWhoSelection("mom", roster, ["dad"]), {
      who: "mom",
      memberIds: ["mom"],
    });
  });

  test("offers multi-select when several participants or historical IDs require it", () => {
    assert.equal(
      showSeveralOption(1, 1, { who: "several", memberIds: ["dad", "ex"] }),
      true,
    );
    assert.equal(
      showSeveralOption(1, 1, { who: "dad", memberIds: ["dad", "ex"] }),
      true,
    );
    assert.equal(
      showSeveralOption(1, 0, { who: "dad", memberIds: ["dad"] }),
      false,
    );
    assert.equal(showSeveralOption(2, 0, { who: "none", memberIds: [] }), true);
  });
});
