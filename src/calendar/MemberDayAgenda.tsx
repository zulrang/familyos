"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import type { MemberId } from "@/members/members";
import { redirectIfPairingRequired } from "@/shared/display-client";
import { addDays, startOfDay } from "./calendar";
import styles from "./MemberDayAgenda.module.css";
import { memberDayEvents, memberDayTime } from "./member-day";
import type { CalendarRead } from "./types";

const calendarReadSchema = z.object({
  events: z.array(
    z
      .object({
        id: z.string(),
        title: z.string(),
        allDay: z.boolean(),
        startMs: z.number().finite(),
        endMs: z.number().finite(),
        participantIds: z.array(z.string()),
        expectedVersion: z.string(),
      })
      .refine((event) => event.endMs > event.startMs),
  ),
  stale: z.boolean(),
});

type ReadState =
  | { kind: "loading" }
  | { kind: "ready"; read: CalendarRead }
  | { kind: "error" };

export function MemberDayAgenda({
  memberId,
  day,
  timeZone,
  calendarId,
}: {
  memberId: MemberId;
  day: Date;
  timeZone: string;
  calendarId: string | null;
}) {
  const [state, setState] = useState<ReadState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const fromIso = startOfDay(day, timeZone).toISOString();
  const toIso = addDays(new Date(fromIso), 1, timeZone).toISOString();
  const url = `/api/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

  useEffect(() => {
    if (!calendarId) return;
    if (retry > 0) setState({ kind: "loading" });
    let controller: AbortController | null = null;
    async function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(url, { signal: current.signal });
        if (current.signal.aborted) return;
        if (await redirectIfPairingRequired(response)) return;
        if (!response.ok) throw new Error("calendar read failed");
        const read = calendarReadSchema.parse(await response.json());
        if (current.signal.aborted) return;
        setState({ kind: "ready", read });
      } catch (error) {
        if (!current.signal.aborted) {
          console.error("member day calendar:", error);
          setState({ kind: "error" });
        }
      }
    }
    load();
    const poll = setInterval(load, 60_000);
    return () => {
      clearInterval(poll);
      controller?.abort();
    };
  }, [calendarId, retry, url]);

  const events =
    state.kind === "ready"
      ? memberDayEvents(state.read.events, memberId, day, timeZone)
      : [];

  return (
    <section className={styles.agenda} aria-label="Today’s calendar">
      <h3>Today’s calendar</h3>
      {!calendarId ? (
        <p className={styles.message}>Choose a family calendar in Settings.</p>
      ) : state.kind === "loading" ? (
        <output className={styles.message}>Loading calendar…</output>
      ) : state.kind === "error" ? (
        <div className={styles.message} role="alert">
          <p>Could not load today’s calendar.</p>
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              setRetry((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {state.read.stale ? (
            <p className={styles.message}>Showing saved calendar events.</p>
          ) : null}
          {events.length === 0 ? (
            <p className={styles.message}>No calendar events today.</p>
          ) : (
            <ol className={styles.events}>
              {events.map((event) => (
                <li className={styles.event} key={event.id}>
                  <span className={styles.eventTime}>
                    {memberDayTime(event, timeZone)}
                  </span>
                  <span className={styles.eventTitle}>{event.title}</span>
                  {event.participantIds.length === 0 ? (
                    <span className={styles.household}>Household</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
