/**
 * DESIGN-DEVIATION: hand-authored Google Calendar HTTP shapes, not cassettes from a
 * live capture and not a live lane. Code-design Parity allows recorded responses
 * or a manual live run; this stands in until either exists, so the real
 * `google-events.ts` adapter still shares `assertCalendarGatewayContract` with the Fake.
 * Upgrade: replay captured cassettes, or gate a live run on env.
 *
 * ponytail: all-day overlap uses the calendar TZ from timed writes (else
 * America/New_York). Live Google uses the calendar's own zone.
 */

import { fromDateOnly } from "@/calendar/calendar";
import { zonedDateTimeToMs } from "@/shared/time";

const CAL_ORIGIN = "https://www.googleapis.com/calendar/v3";

type GDate = { dateTime?: string; date?: string; timeZone?: string };

type Stored = {
  id: string;
  summary: string;
  start: GDate;
  end: GDate;
  startMs: number;
  endMs: number;
  private: Record<string, string>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function empty(status: number): Response {
  return new Response(null, { status });
}

function parseIncoming(
  d: GDate | undefined,
  calendarTz: string,
): { ms: number; g: GDate } | null {
  if (!d) return null;
  if (d.date) {
    return {
      ms: fromDateOnly(d.date, d.timeZone ?? calendarTz),
      g: { date: d.date },
    };
  }
  if (!d.dateTime) return null;
  let ms: number;
  if (/Z|[+-]\d{2}:\d{2}$/.test(d.dateTime)) {
    ms = Date.parse(d.dateTime);
  } else {
    const [date, rest] = d.dateTime.split("T");
    ms = zonedDateTimeToMs(
      date ?? "",
      (rest ?? "00:00").slice(0, 5),
      d.timeZone ?? calendarTz,
    );
  }
  return {
    ms,
    g: {
      dateTime: new Date(ms).toISOString(),
      timeZone: d.timeZone ?? calendarTz,
    },
  };
}

function toGEvent(ev: Stored): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: ev.id,
    summary: ev.summary,
    start: ev.start,
    end: ev.end,
  };
  if (Object.keys(ev.private).length > 0) {
    out.extendedProperties = { private: { ...ev.private } };
  }
  return out;
}

export function createRecordedCalendarGfetch(): (
  url: string,
  init?: RequestInit,
) => Promise<Response> {
  const events = new Map<string, Stored>();
  let seq = 0;
  let calendarTz = "America/New_York";

  return async (url, init) => {
    const u = new URL(url);
    if (!u.href.startsWith(CAL_ORIGIN)) {
      throw new Error(`unexpected recorded URL ${url}`);
    }
    const path = u.pathname.replace(/^\/calendar\/v3/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body != null
          ? String(init.body)
          : "";
    const body = bodyText
      ? (JSON.parse(bodyText) as {
          summary?: string;
          start?: GDate;
          end?: GDate;
          extendedProperties?: { private?: Record<string, string | null> };
        })
      : {};

    const eventsPath = path.match(
      /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/,
    );
    if (!eventsPath) {
      throw new Error(`unhandled recorded Calendar ${method} ${path}`);
    }
    const eventId = eventsPath[2] ? decodeURIComponent(eventsPath[2]) : null;

    if (!eventId && method === "POST") {
      const start = parseIncoming(body.start, calendarTz);
      const end = parseIncoming(body.end, calendarTz);
      if (!start || !end) return empty(400);
      if (body.start?.timeZone) calendarTz = body.start.timeZone;
      seq += 1;
      const id = `gevt-${seq}`;
      const privateProps: Record<string, string> = {};
      for (const [k, v] of Object.entries(
        body.extendedProperties?.private ?? {},
      )) {
        if (v != null) privateProps[k] = v;
      }
      const ev: Stored = {
        id,
        summary: String(body.summary ?? ""),
        start: start.g,
        end: end.g,
        startMs: start.ms,
        endMs: end.ms,
        private: privateProps,
      };
      events.set(id, ev);
      return json(toGEvent(ev));
    }

    if (!eventId && method === "GET") {
      const timeMinMs = Date.parse(u.searchParams.get("timeMin") ?? "");
      const timeMaxMs = Date.parse(u.searchParams.get("timeMax") ?? "");
      const items = [...events.values()]
        .filter((e) => e.endMs > timeMinMs && e.startMs < timeMaxMs)
        .sort((a, b) => a.startMs - b.startMs)
        .map(toGEvent);
      return json({ items });
    }

    if (eventId && method === "PATCH") {
      const cur = events.get(eventId);
      if (!cur) return empty(404);
      const start = parseIncoming(body.start, calendarTz);
      const end = parseIncoming(body.end, calendarTz);
      if (start) {
        cur.start = start.g;
        cur.startMs = start.ms;
      }
      if (end) {
        cur.end = end.g;
        cur.endMs = end.ms;
      }
      if (body.summary !== undefined) cur.summary = String(body.summary);
      if (body.start?.timeZone) calendarTz = body.start.timeZone;
      for (const [k, v] of Object.entries(
        body.extendedProperties?.private ?? {},
      )) {
        if (v == null || v === "") delete cur.private[k];
        else cur.private[k] = v;
      }
      return json(toGEvent(cur));
    }

    if (eventId && method === "DELETE") {
      if (!events.has(eventId)) return empty(404);
      events.delete(eventId);
      return empty(204);
    }

    throw new Error(`unhandled recorded Calendar ${method} ${path}`);
  };
}
