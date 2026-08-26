import type { EventWrite } from "@/calendar/google-events";
import type { CalEvent, SeriesScope } from "@/calendar/types";
import { rethrowAsUnavailable } from "./calendar-error";
import * as events from "./google-events";

/** Port for Household Calendar event operations (Google adapter / Fake). */
export type CalendarGateway = {
  listEvents: (
    calendarId: string,
    timeMin: string,
    timeMax: string,
    timeZone: string,
  ) => Promise<CalEvent[]>;
  insertEvent: (
    calendarId: string,
    w: EventWrite,
    timeZone: string,
  ) => Promise<CalEvent>;
  updateEvent: (
    calendarId: string,
    eventId: string,
    w: EventWrite,
    scope: SeriesScope,
    timeZone: string,
    expectedVersion: string,
  ) => Promise<CalEvent>;
  deleteEvent: (
    calendarId: string,
    eventId: string,
    scope: SeriesScope,
    timeZone: string,
    expectedVersion: string,
  ) => Promise<void>;
};

function live<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      rethrowAsUnavailable(e);
    }
  };
}

/** Real Google Calendar adapter behind the CalendarGateway port. */
export function googleCalendarGateway(): CalendarGateway {
  return {
    listEvents: live(events.listEvents),
    insertEvent: live(events.insertEvent),
    updateEvent: live(events.updateEvent),
    deleteEvent: live(events.deleteEvent),
  };
}
