import assert from "node:assert/strict";
import { fromDateAndTime, fromDateOnly } from "@/calendar/calendar";
import { EventConflictError } from "./calendar-error";
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
  assert.ok(piano.expectedVersion);
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
  assert.equal(
    listed.find((e) => e.id === piano.id)?.expectedVersion,
    piano.expectedVersion,
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

  const stalePiano = piano.expectedVersion;
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
    stalePiano,
  );
  assert.equal(updated.title, "Piano recital");
  assert.deepEqual(updated.participantIds, ["ellie"]);
  assert.notEqual(updated.expectedVersion, stalePiano);

  const afterUpdate = await gateway.listEvents(
    CAL,
    iso(windowStart),
    iso(windowEnd),
    TZ,
  );
  const found = afterUpdate.find((e) => e.id === piano.id);
  assert.equal(found?.title, "Piano recital");
  assert.deepEqual(found?.participantIds, ["ellie"]);
  assert.equal(found?.expectedVersion, updated.expectedVersion);

  await assert.rejects(
    () =>
      gateway.updateEvent(
        CAL,
        piano.id,
        {
          title: "stolen",
          allDay: false,
          startMs: pianoStart,
          endMs: pianoEnd,
          participantIds: [],
        },
        "this",
        TZ,
        stalePiano,
      ),
    (e: unknown) => {
      assert.equal(e instanceof EventConflictError, true);
      const conflict = e as EventConflictError;
      assert.equal(conflict.event?.id, piano.id);
      assert.equal(conflict.event?.title, "Piano recital");
      assert.deepEqual(conflict.event?.participantIds, ["ellie"]);
      return true;
    },
  );
  assert.equal(
    (await gateway.listEvents(CAL, iso(windowStart), iso(windowEnd), TZ)).find(
      (e) => e.id === piano.id,
    )?.title,
    "Piano recital",
  );

  await assert.rejects(
    () =>
      gateway.updateEvent(
        CAL,
        piano.id,
        {
          title: "stolen following",
          allDay: false,
          startMs: pianoStart,
          endMs: pianoEnd,
          participantIds: ["ellie"],
        },
        "following",
        TZ,
        stalePiano,
      ),
    EventConflictError,
  );
  await assert.rejects(
    () => gateway.deleteEvent(CAL, piano.id, "all", TZ, stalePiano),
    (e: unknown) => {
      assert.equal(e instanceof EventConflictError, true);
      assert.equal((e as EventConflictError).event?.id, piano.id);
      return true;
    },
  );
  assert.equal(
    (await gateway.listEvents(CAL, iso(windowStart), iso(windowEnd), TZ)).some(
      (e) => e.id === piano.id,
    ),
    true,
  );

  await gateway.deleteEvent(CAL, picnic.id, "this", TZ, picnic.expectedVersion);
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
