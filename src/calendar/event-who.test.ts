/**
 * EventSheet Who selection — preserve Retired Member IDs (#7 / Bugbot).
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { Member } from "@/members/members";
import {
  applyWhoSelection,
  eventWhoFromIds,
  historicalParticipantIds,
  showSeveralOption,
} from "./event-who";

const roster: Member[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "mom", name: "Mom", status: "active", color: "#f9c0bc" },
  { id: "ex", name: "Ex", status: "retired" },
];

describe("Event Participant selection", () => {
  test("derives selection mode from participant IDs", () => {
    assert.deepEqual(eventWhoFromIds([]), { kind: "none" });
    assert.deepEqual(eventWhoFromIds(["dad"]), {
      kind: "one",
      memberId: "dad",
    });
    assert.deepEqual(eventWhoFromIds(["dad", "ex"]), { kind: "several" });
  });

  test("identifies Retired Members still on the event", () => {
    assert.deepEqual(historicalParticipantIds(roster, ["dad", "ex"]), ["ex"]);
    assert.deepEqual(historicalParticipantIds(roster, ["dad"]), []);
  });

  test("picking one Active Member keeps Retired IDs and switches to several", () => {
    assert.deepEqual(
      applyWhoSelection({ kind: "one", memberId: "dad" }, roster, ["ex"]),
      {
        who: { kind: "several" },
        memberIds: ["dad", "ex"],
      },
    );
  });

  test("clearing participants yields a Household Event", () => {
    assert.deepEqual(
      applyWhoSelection({ kind: "none" }, roster, ["dad", "ex"]),
      {
        who: { kind: "none" },
        memberIds: [],
      },
    );
  });

  test("multi-select keeps the current participant list", () => {
    assert.deepEqual(applyWhoSelection({ kind: "several" }, roster, ["ex"]), {
      who: { kind: "several" },
      memberIds: ["ex"],
    });
  });

  test("without historical IDs, a single Active pick replaces the list", () => {
    assert.deepEqual(
      applyWhoSelection({ kind: "one", memberId: "mom" }, roster, ["dad"]),
      {
        who: { kind: "one", memberId: "mom" },
        memberIds: ["mom"],
      },
    );
  });

  test("offers multi-select when several participants or historical IDs require it", () => {
    assert.equal(
      showSeveralOption(1, 1, {
        who: { kind: "several" },
        memberIds: ["dad", "ex"],
      }),
      true,
    );
    assert.equal(
      showSeveralOption(1, 1, {
        who: { kind: "one", memberId: "dad" },
        memberIds: ["dad", "ex"],
      }),
      true,
    );
    assert.equal(
      showSeveralOption(1, 0, {
        who: { kind: "one", memberId: "dad" },
        memberIds: ["dad"],
      }),
      false,
    );
    assert.equal(
      showSeveralOption(2, 0, { who: { kind: "none" }, memberIds: [] }),
      true,
    );
  });
});
