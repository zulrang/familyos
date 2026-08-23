import assert from "node:assert/strict";
import { fromDateAndTime, fromDateOnly } from "@/calendar/calendar";
import type { CalendarGateway } from "./calendar-gateway";

const TZ = "America/New_York";
const CAL = "household-cal";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Shared CalendarGateway contract: Fake (unit lane) and Google adapter
 * (contract lane / recorded Calendar HTTP) must both pass.
 */
export async function assertCalendarGatewayContract(
  gateway: CalendarGateway,
): Promise<void> {
  const pianoStart = fromDateAndTime("2026-08-19", "10:00", TZ);
  const pianoEnd = fromDateAndTime("2026-08-19", "11:00", TZ);
  const piano = await gateway.insertEvent(
    CAL,
    {
      title: "Piano",
      allDay: false,
      startMs: pianoStart,
      endMs: pianoEnd,
      participantIds: [],
    },
    TZ,
  );
  assert.equal(piano.title, "Piano");
  assert.equal(piano.allDay, false);
  assert.deepEqual(piano.participantIds, []);
  assert.ok(piano.id);
  assert.equal(piano.startMs, pianoStart);
  assert.equal(piano.endMs, pianoEnd);

  const picnicStart = fromDateOnly("2026-08-20", TZ);
  const picnicEnd = fromDateOnly("2026-08-21", TZ);
  const picnic = await gateway.insertEvent(
    CAL,
    {
      title: "Picnic",
      allDay: true,
      startMs: picnicStart,
      endMs: picnicEnd,
      participantIds: ["dad", "mom"],
    },
    TZ,
  );
  assert.equal(picnic.title, "Picnic");
  assert.equal(picnic.allDay, true);
  assert.deepEqual(picnic.participantIds, ["dad", "mom"]);
  assert.equal(picnic.startMs, picnicStart);
  assert.equal(picnic.endMs, picnicEnd);

  const dupes = await gateway.insertEvent(
    CAL,
    {
      title: "Dupes",
      allDay: false,
      startMs: fromDateAndTime("2026-08-19", "14:00", TZ),
      endMs: fromDateAndTime("2026-08-19", "15:00", TZ),
      participantIds: [" dad ", "dad", "ellie"],
    },
    TZ,
  );
  assert.deepEqual(dupes.participantIds, ["dad", "ellie"]);

  const windowStart = fromDateOnly("2026-08-19", TZ);
  const windowEnd = fromDateOnly("2026-08-22", TZ);
  const listed = await gateway.listEvents(
    CAL,
    iso(windowStart),
    iso(windowEnd),
    TZ,
  );
  assert.deepEqual(
    listed.map((e) => e.id),
    [piano.id, dupes.id, picnic.id],
  );

  const day19 = await gateway.listEvents(
    CAL,
    iso(fromDateOnly("2026-08-19", TZ)),
    iso(fromDateOnly("2026-08-20", TZ)),
    TZ,
  );
  assert.equal(
    day19.some((e) => e.id === picnic.id),
    false,
  );
  assert.equal(
    day19.some((e) => e.id === piano.id),
    true,
  );

  const updated = await gateway.updateEvent(
    CAL,
    piano.id,
    {
      title: "Piano recital",
      allDay: false,
      startMs: pianoStart,
      endMs: pianoEnd,
      participantIds: ["ellie"],
    },
    "this",
    TZ,
  );
  assert.equal(updated.title, "Piano recital");
  assert.deepEqual(updated.participantIds, ["ellie"]);

  const afterUpdate = await gateway.listEvents(
    CAL,
    iso(windowStart),
    iso(windowEnd),
    TZ,
  );
  const found = afterUpdate.find((e) => e.id === piano.id);
  assert.equal(found?.title, "Piano recital");
  assert.deepEqual(found?.participantIds, ["ellie"]);

  await gateway.deleteEvent(CAL, picnic.id, "this", TZ);
  const afterDelete = await gateway.listEvents(
    CAL,
    iso(windowStart),
    iso(windowEnd),
    TZ,
  );
  assert.equal(
    afterDelete.some((e) => e.id === picnic.id),
    false,
  );
}
