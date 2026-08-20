/**
 * Event Participant identity seam (#7).
 * IDs in Google private props — never color or attendee email.
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  isHouseholdEvent,
  normalizeParticipantIds,
  PARTICIPANTS_PROP,
  parseParticipantIds,
  serializeParticipantIds,
} from "./participants";

describe("Event Participants", () => {
  test("stores IDs under the FamilyOS private property key", () => {
    assert.equal(PARTICIPANTS_PROP, "familyosParticipants");
  });

  test("missing or empty IDs are a Household Event", () => {
    assert.deepEqual(parseParticipantIds(undefined), []);
    assert.deepEqual(parseParticipantIds(null), []);
    assert.deepEqual(parseParticipantIds(""), []);
    assert.equal(isHouseholdEvent([]), true);
  });

  test("round-trips create and edit participant payloads", () => {
    assert.deepEqual(parseParticipantIds("dad,mom"), ["dad", "mom"]);
    assert.equal(serializeParticipantIds(["dad", "mom"]), "dad,mom");
    assert.deepEqual(
      parseParticipantIds(serializeParticipantIds(["ellie", "harper"])),
      ["ellie", "harper"],
    );
    assert.equal(isHouseholdEvent(["dad"]), false);
  });

  test("trims blanks and de-dupes IDs with first-wins order", () => {
    assert.deepEqual(parseParticipantIds(" dad , , mom ,dad "), ["dad", "mom"]);
    assert.equal(
      serializeParticipantIds([" dad ", "dad", "", "mom"]),
      "dad,mom",
    );
    assert.deepEqual(normalizeParticipantIds([" dad ", "dad", "", "mom"]), [
      "dad",
      "mom",
    ]);
  });

  test("serializing an empty list clears prior IDs", () => {
    assert.equal(serializeParticipantIds([]), "");
  });
});
