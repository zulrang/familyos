"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  addDays,
  fromDateAndTime,
  fromDateOnly,
  msToDateInput,
  msToTimeInput,
  nextHour,
} from "@/calendar/calendar";
import type { CalEvent, CalendarRead } from "@/calendar/types";
import type { Member, MemberId } from "@/members/members";
import type { PublicSettings } from "@/settings/types";
import { redirectIfPairingRequired } from "@/shared/display-client";
import { type EventDraft, EventSheet } from "./EventSheet";

function toDraft(ev: CalEvent, timeZone: string): EventDraft {
  const endInclusive = ev.allDay
    ? addDays(new Date(ev.endMs), -1, timeZone).getTime()
    : ev.endMs;
  return {
    id: ev.id,
    title: ev.title,
    allDay: ev.allDay,
    date: msToDateInput(ev.startMs, timeZone),
    endDate: msToDateInput(endInclusive, timeZone),
    startTime: msToTimeInput(ev.startMs, timeZone),
    endTime: msToTimeInput(ev.endMs, timeZone),
    // Round-trip stored IDs even if some no longer resolve on the roster.
    memberIds: [...ev.participantIds],
    recurringEventId: ev.recurringEventId,
    expectedVersion: ev.expectedVersion,
    scope: "this",
  };
}

/** A new one-hour event: from `seed.start`, or from the next full hour. */
export type NewEventSeed = { start?: Date; memberIds?: MemberId[] };

function createDraft(seed: NewEventSeed, timeZone: string): EventDraft {
  const span = seed.start
    ? {
        startMs: seed.start.getTime(),
        endMs: seed.start.getTime() + 3_600_000,
      }
    : nextHour(new Date(), timeZone);
  return {
    title: "",
    allDay: false,
    date: msToDateInput(span.startMs, timeZone),
    endDate: msToDateInput(span.startMs, timeZone),
    startTime: msToTimeInput(span.startMs, timeZone),
    endTime: msToTimeInput(span.endMs, timeZone),
    memberIds: seed.memberIds ?? [],
    scope: "this",
  };
}

/** Half-open instant range of events to read, as ISO strings. */
export type EventRange = { from: string; to: string };

/** The Household Calendar as one screen reads and edits it. */
export type HouseholdCalendar = {
  settings: PublicSettings | null;
  members: Member[];
  events: CalEvent[];
  /** A live, signed-in read: events may be created and changed. */
  canMutate: boolean;
  /** Why the calendar is empty or read-only, or the last failure. */
  notice: string | null;
  editEvent: (event: CalEvent) => void;
  newEvent: (seed?: NewEventSeed) => void;
  /** The open event editor, if any. Render inside a positioned screen. */
  editor: ReactNode;
};

/** Reads `rangeFor(Household Time Zone)` and re-reads every minute. */
export function useHouseholdCalendar(
  rangeFor: (timeZone: string) => EventRange,
): HouseholdCalendar {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [calendarRead, setCalendarRead] = useState<CalendarRead>({
    events: [],
    stale: false,
  });
  const [sheet, setSheet] = useState<EventDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeZone = settings?.timeZone;
  const members = settings?.members ?? [];
  const stale = calendarRead.stale;
  const bounds = timeZone ? rangeFor(timeZone) : null;
  const from = bounds?.from;
  const to = bounds?.to;

  async function load(signal?: AbortSignal) {
    const req = signal ? { signal } : undefined;
    const sRes = await fetch("/api/settings", req);
    if (signal?.aborted) return;
    if (await redirectIfPairingRequired(sRes)) return;
    const s = (await sRes.json()) as PublicSettings;
    if (signal?.aborted) return;
    setSettings(s);
    if (!s.calendarId) {
      setCalendarRead({ events: [], stale: false });
      return;
    }
    const range = rangeFor(s.timeZone);
    const eRes = await fetch(
      `/api/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      req,
    );
    if (signal?.aborted) return;
    if (await redirectIfPairingRequired(eRes)) return;
    if (eRes.status === 401) {
      setCalendarRead({ events: [], stale: false });
      setSettings({ ...s, signedIn: false });
      return;
    }
    if (!eRes.ok) {
      setCalendarRead((cur) => ({ ...cur, stale: true }));
      setError("Could not load events.");
      return;
    }
    const data = (await eRes.json()) as CalendarRead;
    if (signal?.aborted) return;
    setCalendarRead({
      events: Array.isArray(data.events) ? data.events : [],
      stale: data.stale === true,
    });
    setError(null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the visible range bounds change
  useEffect(() => {
    let inFlight: AbortController | null = null;
    const run = () => {
      inFlight?.abort();
      const ac = new AbortController();
      inFlight = ac;
      return load(ac.signal).catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not load calendar.");
      });
    };
    run();
    const poll = setInterval(run, 60_000);
    return () => {
      inFlight?.abort();
      clearInterval(poll);
    };
  }, [from, to]);

  function applyCurrentEvent(eventId: string, current: CalEvent | null) {
    setCalendarRead((cur) => ({
      ...cur,
      events: current
        ? cur.events.map((e) => (e.id === eventId ? current : e))
        : cur.events.filter((e) => e.id !== eventId),
    }));
  }

  /** Keep the open editor when a 409 includes `event`; a missing key is not a delete. */
  async function reloadConflictingEvent(res: Response, eventId: string) {
    const body = (await res.json()) as { event?: CalEvent | null };
    if ("event" in body) {
      applyCurrentEvent(eventId, body.event ?? null);
      if (timeZone) {
        setSheet((s) => {
          if (!s?.id || s.id !== eventId) return s;
          if (!body.event) return null;
          return toDraft(body.event, timeZone);
        });
      }
    }
    setError("This event changed on another Display. Reloaded — try again.");
  }

  async function save(draft: EventDraft) {
    if (!timeZone) return;
    setBusy(true);
    try {
      const startMs = draft.allDay
        ? fromDateOnly(draft.date, timeZone)
        : fromDateAndTime(draft.date, draft.startTime, timeZone);
      const endMs = draft.allDay
        ? addDays(
            new Date(fromDateOnly(draft.endDate, timeZone)),
            1,
            timeZone,
          ).getTime()
        : fromDateAndTime(draft.date, draft.endTime, timeZone);
      const body: Record<string, unknown> = {
        title: draft.title.trim() || "Busy",
        allDay: draft.allDay,
        startMs,
        endMs,
        participantIds: draft.memberIds,
        scope: draft.recurringEventId ? draft.scope : "this",
      };
      if (draft.id) body.expectedVersion = draft.expectedVersion ?? "";
      const res = await fetch(
        draft.id
          ? `/api/events/${encodeURIComponent(draft.id)}`
          : "/api/events",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 409 && draft.id) {
        await reloadConflictingEvent(res, draft.id);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setSheet(null);
      await load();
    } catch {
      setError("Could not save event.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(draft: EventDraft) {
    if (!draft.id) return;
    const scope = draft.recurringEventId ? draft.scope : "this";
    const msg =
      scope === "all"
        ? "Delete all events in this series?"
        : scope === "following"
          ? "Delete this and following events?"
          : "Delete this event?";
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const q = scope === "this" ? "" : `?scope=${scope}`;
      const res = await fetch(
        `/api/events/${encodeURIComponent(draft.id)}${q}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: draft.expectedVersion ?? "",
          }),
        },
      );
      if (res.status === 409) {
        await reloadConflictingEvent(res, draft.id);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setSheet(null);
      await load();
    } catch {
      setError("Could not delete event.");
    } finally {
      setBusy(false);
    }
  }

  const canMutate = Boolean(
    settings?.signedIn && settings.calendarId && !stale,
  );
  const notice = !settings
    ? null
    : stale
      ? "Google is unavailable. Calendar is read-only."
      : !settings.googleConfigured
        ? "Add Google credentials in .env.local, then sign in under Settings."
        : !settings.signedIn
          ? "Sign in with Google under Settings to load the family calendar."
          : !settings.calendarId
            ? "Pick a family calendar under Settings."
            : error;

  return {
    settings,
    members,
    events: calendarRead.events,
    canMutate,
    notice,
    editEvent: (event) => {
      if (timeZone) setSheet(toDraft(event, timeZone));
    },
    newEvent: (seed = {}) => {
      if (timeZone) setSheet(createDraft(seed, timeZone));
    },
    editor: sheet ? (
      <EventSheet
        draft={sheet}
        members={members}
        busy={busy}
        onChange={setSheet}
        onClose={() => setSheet(null)}
        onSave={() => save(sheet)}
        onDelete={sheet.id ? () => remove(sheet) : undefined}
      />
    ) : null,
  };
}
