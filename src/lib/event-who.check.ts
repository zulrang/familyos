/**
 * EventSheet Who selection — preserve Retired Member IDs (#7 / Bugbot).
 */
import assert from "node:assert/strict";
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

assert.equal(whoFromIds([]), "none");
assert.equal(whoFromIds(["dad"]), "dad");
assert.equal(whoFromIds(["dad", "ex"]), "several");

assert.deepEqual(historicalParticipantIds(roster, ["dad", "ex"]), ["ex"]);
assert.deepEqual(historicalParticipantIds(roster, ["dad"]), []);

// Single Active pick keeps Retired IDs and switches to several
assert.deepEqual(applyWhoSelection("dad", roster, ["ex"]), {
  who: "several",
  memberIds: ["dad", "ex"],
});
// Nobody clears historical too (Household Event)
assert.deepEqual(applyWhoSelection("none", roster, ["dad", "ex"]), {
  who: "none",
  memberIds: [],
});
// Several keeps current list
assert.deepEqual(applyWhoSelection("several", roster, ["ex"]), {
  who: "several",
  memberIds: ["ex"],
});
// No historical → single Active as before
assert.deepEqual(applyWhoSelection("mom", roster, ["dad"]), {
  who: "mom",
  memberIds: ["mom"],
});

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

console.log("event-who.check ok");
