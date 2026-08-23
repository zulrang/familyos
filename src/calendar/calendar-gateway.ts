import type { EventWrite } from "@/calendar/google-events";
import type { CalEvent, SeriesScope } from "@/calendar/types";
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
  ) => Promise<CalEvent>;
  deleteEvent: (
    calendarId: string,
    eventId: string,
    scope: SeriesScope,
    timeZone: string,
  ) => Promise<void>;
};

/** Real Google Calendar adapter behind the CalendarGateway port. */
export function googleCalendarGateway(): CalendarGateway {
  return {
    listEvents: events.listEvents,
    insertEvent: events.insertEvent,
    updateEvent: events.updateEvent,
    deleteEvent: events.deleteEvent,
  };
}
