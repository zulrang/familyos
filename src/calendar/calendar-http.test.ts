/**
 * HTTP acceptance seam for Calendar events. Uses shared Calendar Fake — no live Google.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import { fromDateAndTime, fromDateOnly } from "@/calendar/calendar";
import type { CalEvent } from "@/calendar/types";
import { createFakeCalendarGateway } from "./calendar-fake";

const TZ = "America/New_York";

describe("Calendar HTTP", () => {
  let dataRoot: string;
  let handleListEvents: typeof import("./calendar-http.ts").handleListEvents;
  let handleCreateEvent: typeof import("./calendar-http.ts").handleCreateEvent;
  let handleUpdateEvent: typeof import("./calendar-http.ts").handleUpdateEvent;
  let handleDeleteEvent: typeof import("./calendar-http.ts").handleDeleteEvent;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let emitStartupPairingCode: typeof import("@/shared/pairing").emitStartupPairingCode;
  let DISPLAY_COOKIE: typeof import("@/shared/pairing").DISPLAY_COOKIE;
  let handlePair: typeof import("@/displays/pairing-http").handlePair;
  let cookieHeader: string;
  let gateway: ReturnType<typeof createFakeCalendarGateway>;

  const pianoStart = fromDateAndTime("2026-08-19", "10:00", TZ);
  const pianoEnd = fromDateAndTime("2026-08-19", "11:00", TZ);
  const from = new Date(fromDateOnly("2026-08-19", TZ)).toISOString();
  const to = new Date(fromDateOnly("2026-08-22", TZ)).toISOString();

  beforeAll(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-cal-http-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      handleListEvents,
      handleCreateEvent,
      handleUpdateEvent,
      handleDeleteEvent,
    } = await import("./calendar-http.ts"));
    ({ writeHousehold } = await import("@/settings/settings"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE } = await import(
      "@/shared/pairing"
    ));
    ({ handlePair } = await import("@/displays/pairing-http"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "CalHousehold",
      members: [{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }],
      calendarId: "cal-household",
      calendarTimeZone: TZ,
      listIds: [],
      timeZone: TZ,
      configVersion: 1,
    });

    gateway = createFakeCalendarGateway([
      {
        id: "ev-seed",
        title: "Practice",
        allDay: false,
        startMs: pianoStart,
        endMs: pianoEnd,
        participantIds: ["dad"],
      },
    ]);

    function cookieFrom(res: Response): string | null {
      const raw = res.headers.getSetCookie?.() ?? [];
      if (raw.length) {
        const line = raw.find((c) => c.startsWith(`${DISPLAY_COOKIE}=`));
        return line?.split(";")[0] ?? null;
      }
      const single = res.headers.get("set-cookie");
      if (!single) return null;
      return single.split(";")[0] ?? null;
    }

    const startupCode = await emitStartupPairingCode();
    assert.ok(startupCode);
    const pairRes = await handlePair(
      new Request("http://familyos.test/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: startupCode }),
      }),
    );
    assert.equal(pairRes.status, 200);
    const cookie = cookieFrom(pairRes);
    assert.ok(cookie);
    cookieHeader = cookie;
  });

  afterAll(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function req(url: string, init?: RequestInit): Request {
    return new Request(url, {
      ...init,
      headers: {
        cookie: cookieHeader,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  test("unparseable create body is rejected at the boundary", async () => {
    const res = await handleCreateEvent(
      req("http://familyos.test/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: 1,
          allDay: true,
          startMs: 0,
          endMs: 1,
        }),
      }),
      gateway,
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "invalid body");
  });

  test("GET returns Household Calendar events in the requested range", async () => {
    const res = await handleListEvents(
      req(
        `http://familyos.test/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
      gateway,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { events: CalEvent[] };
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0]?.id, "ev-seed");
    assert.equal(body.events[0]?.title, "Practice");
    assert.deepEqual(body.events[0]?.participantIds, ["dad"]);
  });

  test("create, update, and delete round-trip through the Fake", async () => {
    const createdRes = await handleCreateEvent(
      req("http://familyos.test/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Picnic",
          allDay: true,
          startMs: fromDateOnly("2026-08-20", TZ),
          endMs: fromDateOnly("2026-08-21", TZ),
          participantIds: ["dad"],
        }),
      }),
      gateway,
    );
    assert.equal(createdRes.status, 200);
    const created = (await createdRes.json()) as { event: CalEvent };
    assert.equal(created.event.title, "Picnic");
    assert.equal(created.event.allDay, true);
    assert.deepEqual(created.event.participantIds, ["dad"]);

    const listed = await handleListEvents(
      req(
        `http://familyos.test/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
      gateway,
    );
    const listedBody = (await listed.json()) as { events: CalEvent[] };
    assert.equal(
      listedBody.events.some((e) => e.id === created.event.id),
      true,
    );

    const patched = await handleUpdateEvent(
      req(`http://familyos.test/api/events/${created.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "Park picnic",
          allDay: true,
          startMs: created.event.startMs,
          endMs: created.event.endMs,
          participantIds: [],
        }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(patched.status, 200);
    const patchedBody = (await patched.json()) as { event: CalEvent };
    assert.equal(patchedBody.event.title, "Park picnic");
    assert.deepEqual(patchedBody.event.participantIds, []);

    const deleted = await handleDeleteEvent(
      req(`http://familyos.test/api/events/${created.event.id}`),
      created.event.id,
      gateway,
    );
    assert.equal(deleted.status, 200);
    const after = await handleListEvents(
      req(
        `http://familyos.test/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
      gateway,
    );
    const afterBody = (await after.json()) as { events: CalEvent[] };
    assert.equal(
      afterBody.events.some((e) => e.id === created.event.id),
      false,
    );
  });
});
