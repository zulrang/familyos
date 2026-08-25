/**
 * HTTP acceptance seam for Calendar events and account-bound outage cache
 * (#12). Uses shared Calendar Fake — no live Google.
 */

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
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
  let writeProvider: typeof import("@/shared/provider").writeProvider;
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
    ({ writeProvider } = await import("@/shared/provider"));
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
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "conn",
    });

    gateway = createFakeCalendarGateway([
      {
        id: "ev-seed",
        title: "Practice",
        allDay: false,
        startMs: pianoStart,
        endMs: pianoEnd,
        participantIds: ["dad"],
        expectedVersion: "",
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
    assert.equal(typeof body.events[0]?.expectedVersion, "string");
    assert.ok(body.events[0]?.expectedVersion);
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
          expectedVersion: created.event.expectedVersion,
        }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(patched.status, 200);
    const patchedBody = (await patched.json()) as { event: CalEvent };
    assert.equal(patchedBody.event.title, "Park picnic");
    assert.deepEqual(patchedBody.event.participantIds, []);
    assert.notEqual(
      patchedBody.event.expectedVersion,
      created.event.expectedVersion,
    );

    const deleted = await handleDeleteEvent(
      req(`http://familyos.test/api/events/${created.event.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: patchedBody.event.expectedVersion,
        }),
      }),
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

  test("stale Calendar writes conflict and return the current event", async () => {
    const createdRes = await handleCreateEvent(
      req("http://familyos.test/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Eggs",
          allDay: true,
          startMs: fromDateOnly("2026-08-20", TZ),
          endMs: fromDateOnly("2026-08-21", TZ),
          participantIds: [],
        }),
      }),
      gateway,
    );
    const created = (await createdRes.json()) as { event: CalEvent };
    const stale = created.event.expectedVersion;

    const renamed = await handleUpdateEvent(
      req(`http://familyos.test/api/events/${created.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "Omelette",
          allDay: true,
          startMs: created.event.startMs,
          endMs: created.event.endMs,
          participantIds: [],
          expectedVersion: stale,
        }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(renamed.status, 200);
    const current = ((await renamed.json()) as { event: CalEvent }).event;

    const stolen = await handleUpdateEvent(
      req(`http://familyos.test/api/events/${created.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "stolen",
          allDay: true,
          startMs: created.event.startMs,
          endMs: created.event.endMs,
          participantIds: ["dad"],
          expectedVersion: stale,
        }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(stolen.status, 409);
    const stolenBody = (await stolen.json()) as {
      error: string;
      event: CalEvent;
    };
    assert.equal(stolenBody.error, "version");
    assert.equal(stolenBody.event.title, "Omelette");
    assert.deepEqual(stolenBody.event.participantIds, []);
    assert.equal(gateway.store.get(created.event.id)?.title, "Omelette");

    const staleFollowing = await handleUpdateEvent(
      req(`http://familyos.test/api/events/${created.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "stolen following",
          allDay: true,
          startMs: created.event.startMs,
          endMs: created.event.endMs,
          participantIds: [],
          scope: "following",
          expectedVersion: stale,
        }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(staleFollowing.status, 409);

    const staleDelete = await handleDeleteEvent(
      req(`http://familyos.test/api/events/${created.event.id}?scope=all`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: stale }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(staleDelete.status, 409);
    assert.equal(gateway.store.has(created.event.id), true);

    const gone = await handleDeleteEvent(
      req(`http://familyos.test/api/events/${created.event.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: current.expectedVersion }),
      }),
      created.event.id,
      gateway,
    );
    assert.equal(gone.status, 200);
  });

  test("edit and delete require an expectedVersion", async () => {
    const listed = await handleListEvents(
      req(
        `http://familyos.test/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
      gateway,
    );
    const seed = ((await listed.json()) as { events: CalEvent[] }).events.find(
      (e) => e.id === "ev-seed",
    );
    assert.ok(seed);

    const patch = await handleUpdateEvent(
      req("http://familyos.test/api/events/ev-seed", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Hijack",
          allDay: false,
          startMs: seed.startMs,
          endMs: seed.endMs,
          participantIds: [],
        }),
      }),
      "ev-seed",
      gateway,
    );
    assert.equal(patch.status, 400);
    assert.equal(
      ((await patch.json()) as { error: string }).error,
      "expectedVersion required",
    );
    assert.equal(gateway.store.get("ev-seed")?.title, "Practice");

    const del = await handleDeleteEvent(
      req("http://familyos.test/api/events/ev-seed", { method: "DELETE" }),
      "ev-seed",
      gateway,
    );
    assert.equal(del.status, 400);
    assert.equal(gateway.store.has("ev-seed"), true);
  });
});

describe("Household Calendar outage cache", () => {
  let dataRoot: string;
  let handleListEvents: typeof import("./calendar-http.ts").handleListEvents;
  let handleCreateEvent: typeof import("./calendar-http.ts").handleCreateEvent;
  let handleUpdateEvent: typeof import("./calendar-http.ts").handleUpdateEvent;
  let handleDeleteEvent: typeof import("./calendar-http.ts").handleDeleteEvent;
  let writeHousehold: typeof import("@/settings/settings").writeHousehold;
  let readHousehold: typeof import("@/settings/settings").readHousehold;
  let writeProvider: typeof import("@/shared/provider").writeProvider;
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
    dataRoot = await mkdtemp(path.join(tmpdir(), "familyos-cal-cache-"));
    process.env.FAMILYOS_DATA_DIR = dataRoot;

    ({
      handleListEvents,
      handleCreateEvent,
      handleUpdateEvent,
      handleDeleteEvent,
    } = await import("./calendar-http.ts"));
    ({ writeHousehold, readHousehold } = await import("@/settings/settings"));
    ({ writeProvider } = await import("@/shared/provider"));
    ({ emitStartupPairingCode, DISPLAY_COOKIE } = await import(
      "@/shared/pairing"
    ));
    ({ handlePair } = await import("@/displays/pairing-http"));

    await mkdir(dataRoot, { recursive: true });
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }],
      calendarId: "cal-household",
      calendarTimeZone: TZ,
      listIds: [],
      timeZone: TZ,
      configVersion: 1,
    });
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });

    gateway = createFakeCalendarGateway([
      {
        id: "ev-seed",
        title: "Practice",
        allDay: false,
        startMs: pianoStart,
        endMs: pianoEnd,
        participantIds: ["dad"],
        expectedVersion: "",
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

  function eventsUrl(range = { from, to }): string {
    return `http://familyos.test/api/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  }

  test("an outage returns cached Household Calendar events as stale", async () => {
    const live = await handleListEvents(req(eventsUrl()), gateway);
    assert.equal(live.status, 200);
    const liveBody = (await live.json()) as {
      events: CalEvent[];
      stale: boolean;
    };
    assert.equal(liveBody.stale, false);
    assert.equal(liveBody.events[0]?.title, "Practice");

    gateway.offline = true;
    const stale = await handleListEvents(req(eventsUrl()), gateway);
    assert.equal(stale.status, 200);
    const staleBody = (await stale.json()) as {
      events: CalEvent[];
      stale: boolean;
    };
    assert.equal(staleBody.stale, true);
    assert.deepEqual(
      staleBody.events.map((e) => [e.id, e.title, e.participantIds]),
      [["ev-seed", "Practice", ["dad"]]],
    );
  });

  test("Calendar writes are unavailable while read-only", async () => {
    gateway.offline = false;
    assert.equal(
      (await handleListEvents(req(eventsUrl()), gateway)).status,
      200,
    );
    gateway.offline = true;
    const before = gateway.store.get("ev-seed");
    assert.ok(before);

    for (const res of [
      await handleCreateEvent(
        req("http://familyos.test/api/events", {
          method: "POST",
          body: JSON.stringify({
            title: "Outage",
            allDay: true,
            startMs: fromDateOnly("2026-08-20", TZ),
            endMs: fromDateOnly("2026-08-21", TZ),
            participantIds: ["dad"],
          }),
        }),
        gateway,
      ),
      await handleUpdateEvent(
        req("http://familyos.test/api/events/ev-seed", {
          method: "PATCH",
          body: JSON.stringify({
            title: "Hijack",
            allDay: false,
            startMs: before.startMs,
            endMs: before.endMs,
            participantIds: [],
            expectedVersion: before.expectedVersion,
          }),
        }),
        "ev-seed",
        gateway,
      ),
      await handleDeleteEvent(
        req("http://familyos.test/api/events/ev-seed", {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion: before.expectedVersion }),
        }),
        "ev-seed",
        gateway,
      ),
    ]) {
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "read-only");
    }

    assert.equal(gateway.store.get("ev-seed")?.title, "Practice");
    assert.equal(gateway.store.has("ev-seed"), true);
  });

  test("disconnect returns matching cache as stale without live provider data", async () => {
    gateway.offline = false;
    assert.equal(
      (await handleListEvents(req(eventsUrl()), gateway)).status,
      200,
    );
    await writeProvider({
      tokens: null,
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    const stale = await handleListEvents(req(eventsUrl()), gateway);
    assert.equal(stale.status, 200);
    const body = (await stale.json()) as {
      events: CalEvent[];
      stale: boolean;
    };
    assert.equal(body.stale, true);
    assert.equal(body.events[0]?.title, "Practice");
    const create = await handleCreateEvent(
      req("http://familyos.test/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Outage",
          allDay: true,
          startMs: fromDateOnly("2026-08-20", TZ),
          endMs: fromDateOnly("2026-08-21", TZ),
          participantIds: [],
        }),
      }),
      gateway,
    );
    assert.equal(create.status, 503);
  });

  async function restoreLive() {
    gateway.offline = false;
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-a",
    });
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }],
      calendarId: "cal-household",
      calendarTimeZone: TZ,
      listIds: [],
      timeZone: TZ,
      configVersion: (await readHousehold()).configVersion,
    });
  }

  test("a different Provider Connection never inherits the previous cache", async () => {
    await restoreLive();
    assert.equal(
      (await handleListEvents(req(eventsUrl()), gateway)).status,
      200,
    );
    await writeProvider({
      tokens: {
        access_token: "access-b",
        refresh_token: "refresh-b",
        expiry: Date.now() + 60_000,
      },
      oauthState: null,
      providerConnectionId: "acct-b",
    });
    gateway.offline = true;
    const res = await handleListEvents(req(eventsUrl()), gateway);
    if (res.status === 200) {
      const body = (await res.json()) as {
        events: CalEvent[];
        stale: boolean;
      };
      assert.equal(
        body.events.some((e) => e.id === "ev-seed"),
        false,
      );
    } else {
      assert.ok(res.status >= 400);
    }
  });

  test("changing Household Calendar never reveals another namespace", async () => {
    await restoreLive();
    assert.equal(
      (await handleListEvents(req(eventsUrl()), gateway)).status,
      200,
    );
    await writeHousehold({
      familyName: "CacheHousehold",
      members: [{ id: "dad", name: "Dad", status: "active", color: "#a9d8d2" }],
      calendarId: "cal-other",
      calendarTimeZone: TZ,
      listIds: [],
      timeZone: TZ,
      configVersion: (await readHousehold()).configVersion,
    });
    gateway.offline = true;
    const res = await handleListEvents(req(eventsUrl()), gateway);
    if (res.status === 200) {
      const body = (await res.json()) as { events: CalEvent[] };
      assert.equal(
        body.events.some((e) => e.id === "ev-seed"),
        false,
      );
    } else {
      assert.ok(res.status >= 400);
    }
  });

  test("live writable behavior resumes after Google recovers", async () => {
    await restoreLive();
    const live = await handleListEvents(req(eventsUrl()), gateway);
    assert.equal(live.status, 200);
    assert.equal(((await live.json()) as { stale: boolean }).stale, false);
    const create = await handleCreateEvent(
      req("http://familyos.test/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "Recovered",
          allDay: true,
          startMs: fromDateOnly("2026-08-20", TZ),
          endMs: fromDateOnly("2026-08-21", TZ),
          participantIds: [],
        }),
      }),
      gateway,
    );
    assert.equal(create.status, 200);
    assert.equal(
      ((await create.json()) as { event: { title: string } }).event.title,
      "Recovered",
    );
  });

  test("a cache write failure still returns live writable events", async () => {
    await restoreLive();
    assert.equal(
      (await handleListEvents(req(eventsUrl()), gateway)).status,
      200,
    );
    const seed = gateway.store.get("ev-seed");
    assert.ok(seed);
    seed.title = "Recital";
    const cacheDir = path.join(
      dataRoot,
      "cache",
      "calendar",
      "acct-a",
      encodeURIComponent("cal-household"),
    );
    const cached = await readdir(cacheDir);
    for (const name of cached) {
      await chmod(path.join(cacheDir, name), 0o444);
    }
    try {
      const live = await handleListEvents(req(eventsUrl()), gateway);
      assert.equal(live.status, 200);
      const body = (await live.json()) as {
        events: CalEvent[];
        stale: boolean;
      };
      assert.equal(body.stale, false);
      assert.equal(
        body.events.find((e) => e.id === "ev-seed")?.title,
        "Recital",
      );
    } finally {
      const cached = await readdir(cacheDir);
      for (const name of cached) {
        await chmod(path.join(cacheDir, name), 0o644);
      }
      seed.title = "Practice";
    }
  });

  test("a successful event write is what an outage returns", async () => {
    await restoreLive();
    assert.equal(
      (await handleListEvents(req(eventsUrl()), gateway)).status,
      200,
    );
    const create = await handleCreateEvent(
      req("http://familyos.test/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: "After write",
          allDay: true,
          startMs: fromDateOnly("2026-08-20", TZ),
          endMs: fromDateOnly("2026-08-21", TZ),
          participantIds: [],
        }),
      }),
      gateway,
    );
    assert.equal(create.status, 200);
    const created = (await create.json()) as { event: CalEvent };
    gateway.offline = true;
    const stale = await handleListEvents(req(eventsUrl()), gateway);
    assert.equal(stale.status, 200);
    const body = (await stale.json()) as {
      events: CalEvent[];
      stale: boolean;
    };
    assert.equal(body.stale, true);
    assert.equal(
      body.events.some((e) => e.id === created.event.id),
      true,
    );
  });
});
