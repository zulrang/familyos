import type { EventWrite } from "@/calendar/google-events";
import { normalizeParticipantIds } from "@/calendar/participants";
import type { CalEvent } from "@/calendar/types";
import { EventConflictError, ProviderUnavailableError } from "./calendar-error";
import type { CalendarGateway } from "./calendar-gateway";

export type FakeCalendarGateway = CalendarGateway & {
  readonly store: Map<string, CalEvent>;
  offline: boolean;
};

function overlaps(
  event: CalEvent,
  timeMinMs: number,
  timeMaxMs: number,
): boolean {
  return event.endMs > timeMinMs && event.startMs < timeMaxMs;
}

function fromWrite(
  id: string,
  w: EventWrite,
  expectedVersion: string,
): CalEvent {
  return {
    id,
    title: w.title,
    allDay: w.allDay,
    startMs: w.startMs,
    endMs: w.endMs,
    participantIds: normalizeParticipantIds(w.participantIds),
    expectedVersion,
  };
}

/**
 * In-memory CalendarGateway. Lives beside the Google Calendar adapter
 * (`google-events.ts`).
 *
 * ponytail: one store, calendarId ignored; series scope is a no-op (non-recurring
 * CRUD) but still version-checks. Expand per calendar / recurrence when cache
 * and series splits need it.
 */
export function createFakeCalendarGateway(
  seed: Iterable<CalEvent> = [],
): FakeCalendarGateway {
  const store = new Map<string, CalEvent>();
  let versionSeq = 0;

  function nextVersion(): string {
    versionSeq += 1;
    return `v${versionSeq}`;
  }

  for (const ev of seed) {
    store.set(ev.id, {
      ...ev,
      participantIds: [...ev.participantIds],
      expectedVersion: ev.expectedVersion || nextVersion(),
    });
  }

  let seq = 0;
  let offline = false;

  function requireLive(): void {
    if (offline) throw new ProviderUnavailableError();
  }

  function requireVersion(event: CalEvent, expectedVersion: string): void {
    if (event.expectedVersion !== expectedVersion) {
      throw new EventConflictError({
        ...event,
        participantIds: [...event.participantIds],
      });
    }
  }

  function copy(event: CalEvent): CalEvent {
    return { ...event, participantIds: [...event.participantIds] };
  }

  const gateway: FakeCalendarGateway = {
    get store() {
      return store;
    },
    get offline() {
      return offline;
    },
    set offline(value: boolean) {
      offline = value;
    },

    async listEvents(_calendarId, timeMin, timeMax) {
      requireLive();
      const timeMinMs = Date.parse(timeMin);
      const timeMaxMs = Date.parse(timeMax);
      return [...store.values()]
        .filter((e) => overlaps(e, timeMinMs, timeMaxMs))
        .sort((a, b) => a.startMs - b.startMs)
        .map(copy);
    },

    async insertEvent(_calendarId, w) {
      requireLive();
      seq += 1;
      const ev = fromWrite(`ev-${seq}`, w, nextVersion());
      store.set(ev.id, ev);
      return copy(ev);
    },

    async updateEvent(
      _calendarId,
      eventId,
      w,
      _scope,
      _timeZone,
      expectedVersion,
    ) {
      requireLive();
      const current = store.get(eventId);
      if (!current) throw new Error("missing");
      requireVersion(current, expectedVersion);
      const ev = fromWrite(eventId, w, nextVersion());
      if (current.recurringEventId)
        ev.recurringEventId = current.recurringEventId;
      if (current.originalStartMs !== undefined) {
        ev.originalStartMs = current.originalStartMs;
      }
      store.set(eventId, ev);
      return copy(ev);
    },

    async deleteEvent(
      _calendarId,
      eventId,
      _scope,
      _timeZone,
      expectedVersion,
    ) {
      requireLive();
      const current = store.get(eventId);
      if (!current) throw new Error("missing");
      requireVersion(current, expectedVersion);
      store.delete(eventId);
    },
  };

  return gateway;
}
