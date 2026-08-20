/**
 * Event Participant identity seam (#7).
 * IDs in Google private props — never color or attendee email.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  isHouseholdEvent,
  normalizeParticipantIds,
  PARTICIPANTS_PROP,
  parseParticipantIds,
  serializeParticipantIds,
} from "./participants.ts";

test("participants", () => {
  assert.equal(PARTICIPANTS_PROP, "familyosParticipants");

  // --- Missing / empty → Household Event ---
  assert.deepEqual(parseParticipantIds(undefined), []);
  assert.deepEqual(parseParticipantIds(null), []);
  assert.deepEqual(parseParticipantIds(""), []);
  assert.equal(isHouseholdEvent([]), true);

  // --- Round-trip create/edit payload ---
  assert.deepEqual(parseParticipantIds("dad,mom"), ["dad", "mom"]);
  assert.equal(serializeParticipantIds(["dad", "mom"]), "dad,mom");
  assert.deepEqual(
    parseParticipantIds(serializeParticipantIds(["ellie", "harper"])),
    ["ellie", "harper"],
  );
  assert.equal(isHouseholdEvent(["dad"]), false);

  // --- Trim, skip blanks, de-dupe (first wins) ---
  assert.deepEqual(parseParticipantIds(" dad , , mom ,dad "), ["dad", "mom"]);
  assert.equal(serializeParticipantIds([" dad ", "dad", "", "mom"]), "dad,mom");
  assert.deepEqual(normalizeParticipantIds([" dad ", "dad", "", "mom"]), [
    "dad",
    "mom",
  ]);

  // --- Clear prior IDs ---
  assert.equal(serializeParticipantIds([]), "");
});
