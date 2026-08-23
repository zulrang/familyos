import type { EventWrite } from "@/calendar/google-events";
import { normalizeParticipantIds } from "@/calendar/participants";
import type { CalEvent } from "@/calendar/types";
import type { CalendarGateway } from "./calendar-gateway";

export type FakeCalendarGateway = CalendarGateway & {
  readonly store: Map<string, CalEvent>;
};

function overlaps(
  event: CalEvent,
  timeMinMs: number,
  timeMaxMs: number,
): boolean {
  return event.endMs > timeMinMs && event.startMs < timeMaxMs;
}

function fromWrite(id: string, w: EventWrite): CalEvent {
  return {
    id,
    title: w.title,
    allDay: w.allDay,
    startMs: w.startMs,
    endMs: w.endMs,
    participantIds: normalizeParticipantIds(w.participantIds),
  };
}

/**
 * In-memory CalendarGateway. Lives beside the Google Calendar adapter
 * (`google-events.ts`).
 *
 * ponytail: one store, calendarId ignored; series scope is a no-op (non-recurring
 * CRUD). Expand per calendar / recurrence when cache and series splits need it.
 */
export function createFakeCalendarGateway(
  seed: Iterable<CalEvent> = [],
): FakeCalendarGateway {
  const store = new Map<string, CalEvent>();
  for (const ev of seed) {
    store.set(ev.id, {
      ...ev,
      participantIds: [...ev.participantIds],
    });
  }

  let seq = 0;

  const gateway: FakeCalendarGateway = {
    get store() {
      return store;
    },

    async listEvents(_calendarId, timeMin, timeMax) {
      const timeMinMs = Date.parse(timeMin);
      const timeMaxMs = Date.parse(timeMax);
      return [...store.values()]
        .filter((e) => overlaps(e, timeMinMs, timeMaxMs))
        .sort((a, b) => a.startMs - b.startMs)
        .map((e) => ({ ...e, participantIds: [...e.participantIds] }));
    },

    async insertEvent(_calendarId, w) {
      seq += 1;
      const ev = fromWrite(`ev-${seq}`, w);
      store.set(ev.id, ev);
      return { ...ev, participantIds: [...ev.participantIds] };
    },

    async updateEvent(_calendarId, eventId, w) {
      if (!store.has(eventId)) throw new Error("missing");
      const ev = fromWrite(eventId, w);
      store.set(eventId, ev);
      return { ...ev, participantIds: [...ev.participantIds] };
    },

    async deleteEvent(_calendarId, eventId) {
      if (!store.has(eventId)) throw new Error("missing");
      store.delete(eventId);
    },
  };

  return gateway;
}
