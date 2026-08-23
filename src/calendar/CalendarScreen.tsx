"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDays,
  coversDay,
  eventPaint,
  formatTimeRange,
  fromDateAndTime,
  fromDateOnly,
  gridHeight,
  HOUR_PX,
  heightPx,
  hoursInView,
  isSameDay,
  layoutColumns,
  mountGridScrollTop,
  msToDateInput,
  msToTimeInput,
  nextHour,
  nowLineTop,
  peopleOf,
  remainingDays,
  slotStart,
  statusEvent,
  timedOnDay,
  topPx,
  visibleUnderMemberFilter,
  weekDays,
  weekdayLabel,
} from "@/calendar/calendar";
import { whoFromIds } from "@/calendar/event-who";
import type { CalEvent } from "@/calendar/types";
import {
  LEGACY_TONE_COLORS,
  type Member,
  memberSurface,
} from "@/members/members";
import type { PublicSettings } from "@/settings/types";
import { AppHeader } from "@/shared/AppHeader";
import { redirectIfPairingRequired } from "@/shared/display-client";
import { formatClock, zonedDayOfMonth } from "@/shared/time";
import { Button } from "@/shared/ui/Button";
import { Fab } from "@/shared/ui/Fab";
import { AllDayBar } from "./AllDayBar";
import { DayHeader } from "./DayHeader";
import { EventCard } from "./EventCard";
import { type EventDraft, EventSheet } from "./EventSheet";
import { MemberChip } from "./MemberChip";
import { NowLine } from "./NowLine";
import { TimeGutter } from "./TimeGutter";

function chipSurface(m: Member) {
  if (m.status !== "active") return memberSurface(LEGACY_TONE_COLORS.sand);
  return memberSurface(m.color);
}

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
    who: whoFromIds(ev.participantIds),
    recurringEventId: ev.recurringEventId,
    scope: "this",
  };
}

function createDraft(now: Date, timeZone: string): EventDraft {
  const n = nextHour(now, timeZone);
  return {
    title: "",
    allDay: false,
    date: msToDateInput(n.startMs, timeZone),
    endDate: msToDateInput(n.startMs, timeZone),
    startTime: msToTimeInput(n.startMs, timeZone),
    endTime: msToTimeInput(n.endMs, timeZone),
    memberIds: [],
    who: "none",
    scope: "this",
  };
}

function LiveClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now ? formatClock(now, timeZone) : null;
}

let savedGridScroll: number | null = null;

export function CalendarScreen() {
  const [today, setToday] = useState(() => new Date());
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [showChips, setShowChips] = useState(true);
  const [sheet, setSheet] = useState<EventDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const timeZone = settings?.timeZone;
  const days = timeZone ? weekDays(today, timeZone) : [];
  const members = settings?.members ?? [];
  const from = days[0]?.toISOString();
  const to =
    timeZone && days.length
      ? addDays(days[days.length - 1], 1, timeZone).toISOString()
      : undefined;

  async function load() {
    const sRes = await fetch("/api/settings");
    if (await redirectIfPairingRequired(sRes)) return;
    const s = (await sRes.json()) as PublicSettings;
    setSettings(s);
    if (!s.signedIn || !s.calendarId) {
      setEvents([]);
      return;
    }
    const range = weekDays(today, s.timeZone);
    const rangeFrom = range[0].toISOString();
    const rangeTo = addDays(
      range[range.length - 1],
      1,
      s.timeZone,
    ).toISOString();
    const eRes = await fetch(
      `/api/events?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
    );
    if (await redirectIfPairingRequired(eRes)) return;
    if (eRes.status === 401) {
      setEvents([]);
      setSettings({ ...s, signedIn: false });
      return;
    }
    if (!eRes.ok) {
      setError("Could not load events.");
      return;
    }
    const data = (await eRes.json()) as { events: CalEvent[] };
    setEvents(data.events);
    setError(null);
  }

  useEffect(() => {
    if (!timeZone) return;
    const t = setInterval(() => {
      const n = new Date();
      setToday((p) => (isSameDay(p, n, timeZone) ? p : n));
    }, 60_000);
    return () => clearInterval(t);
  }, [timeZone]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the visible week bounds change
  useEffect(() => {
    load().catch(() => setError("Could not load calendar."));
  }, [from, to]);

  useEffect(() => {
    if (!timeZone) return;
    const el = gridRef.current;
    if (!el) return;
    const base = mountGridScrollTop(savedGridScroll, new Date(), timeZone);
    const headerH = headerRef.current?.offsetHeight ?? 0;
    el.scrollTop = savedGridScroll == null && base > 0 ? base + headerH : base;
    const save = () => {
      savedGridScroll = el.scrollTop;
    };
    el.addEventListener("scroll", save);
    return () => {
      save();
      el.removeEventListener("scroll", save);
    };
  }, [timeZone]);

  const visible = (ev: CalEvent) => visibleUnderMemberFilter(ev, members, off);

  const status = timeZone ? statusEvent(events, today, timeZone) : null;

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
      const body = {
        title: draft.title.trim() || "Busy",
        allDay: draft.allDay,
        startMs,
        endMs,
        participantIds: draft.memberIds,
        scope: draft.recurringEventId ? draft.scope : "this",
      };
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
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(String(res.status));
      setSheet(null);
      await load();
    } catch {
      setError("Could not delete event.");
    } finally {
      setBusy(false);
    }
  }

  const hours = hoursInView();
  const gh = gridHeight();
  const banner = !settings
    ? null
    : !settings.googleConfigured
      ? "Add Google credentials in .env.local, then sign in under Settings."
      : !settings.signedIn
        ? "Sign in with Google under Settings to load the family calendar."
        : !settings.calendarId
          ? "Pick a family calendar under Settings."
          : error;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "var(--surface-screen)",
        position: "relative",
      }}
    >
      <AppHeader
        title={settings?.familyName ?? "Family"}
        time={timeZone ? <LiveClock timeZone={timeZone} /> : null}
        actions={
          <>
            <Button
              icon="columns-3"
              onClick={() => {
                if (gridRef.current) {
                  const headerH = headerRef.current?.offsetHeight ?? 0;
                  gridRef.current.scrollTop = Math.max(
                    0,
                    timeZone
                      ? nowLineTop(new Date(), timeZone) - HOUR_PX + headerH
                      : 0,
                  );
                }
              }}
            >
              Schedule
            </Button>
            <Button icon="eye-off" onClick={() => setShowChips((v) => !v)}>
              Filter
            </Button>
          </>
        }
      />
      {showChips ? (
        <div style={{ display: "flex", gap: 10, padding: "0 24px 12px" }}>
          {status ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "5px 20px",
                border: "1px solid var(--border-card)",
                borderRadius: "var(--radius-pill)",
                font: "var(--type-card-meta)",
                whiteSpace: "nowrap",
              }}
            >
              {status.title}{" "}
              {timeZone ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {remainingDays(status, today, timeZone)} days
                </span>
              ) : null}
            </span>
          ) : null}
          {members.map((p) => (
            <MemberChip
              key={p.id}
              name={p.name}
              surface={chipSurface(p)}
              count={String(
                events.filter((e) => peopleOf([p], e).length).length,
              )}
              active={!off[p.id]}
              onClick={() => setOff((o) => ({ ...o, [p.id]: !o[p.id] }))}
            />
          ))}
        </div>
      ) : null}
      {banner ? (
        <div
          style={{
            padding: "0 24px 12px",
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
          }}
        >
          {banner}
        </div>
      ) : null}
      {timeZone ? (
        <div
          ref={gridRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            borderTop: "1px solid var(--surface-grid-line)",
            touchAction: "pan-y",
            overscrollBehavior: "contain",
          }}
        >
          <div
            ref={headerRef}
            style={{
              display: "grid",
              gridTemplateColumns: `76px repeat(${days.length}, minmax(0, 1fr))`,
              position: "sticky",
              top: 0,
              zIndex: 3,
              background: "var(--surface-screen)",
            }}
          >
            <div />
            {days.map((d) => (
              <div
                key={d.toISOString()}
                style={{
                  minWidth: 0,
                  borderLeft: "1px solid var(--surface-grid-line)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <DayHeader
                  weekday={weekdayLabel(d, timeZone)}
                  date={zonedDayOfMonth(d, timeZone)}
                  today={isSameDay(d, today, timeZone)}
                />
                <div
                  style={{
                    minHeight: 34,
                    padding: "0 6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {events
                    .filter(
                      (e) =>
                        e.allDay && coversDay(e, d, timeZone) && visible(e),
                    )
                    .map((e) => {
                      const people = peopleOf(members, e);
                      const paint = eventPaint(people);
                      return (
                        <AllDayBar
                          key={e.id}
                          label={e.title}
                          soft={paint.soft}
                          multi={paint.multi}
                          style={{ height: 30, cursor: "pointer" }}
                          onClick={() => setSheet(toDraft(e, timeZone))}
                        />
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `76px repeat(${days.length}, minmax(0, 1fr))`,
              borderTop: "1px solid var(--surface-grid-line)",
            }}
          >
            <TimeGutter
              hours={hours}
              rowHeight={HOUR_PX}
              width={76}
              style={{ height: gh }}
            />
            {days.map((d) => {
              const timed = layoutColumns(
                events.filter((e) => timedOnDay(e, d, timeZone) && visible(e)),
              );
              const isToday = isSameDay(d, today, timeZone);
              return (
                <div
                  key={`g-${d.toISOString()}`}
                  style={{
                    minWidth: 0,
                    borderLeft: "1px solid var(--surface-grid-line)",
                    position: "relative",
                    height: gh,
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--surface-grid-line) ${HOUR_PX - 1}px, var(--surface-grid-line) ${HOUR_PX}px)`,
                  }}
                >
                  <button
                    type="button"
                    className="fos-hit"
                    aria-label={`Add event ${weekdayLabel(d, timeZone)}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                    onClick={(e) => {
                      const start = slotStart(
                        d,
                        e.clientY - e.currentTarget.getBoundingClientRect().top,
                        timeZone,
                      );
                      if (!start) return;
                      const end = new Date(start.getTime() + 3600000);
                      setSheet({
                        ...createDraft(start, timeZone),
                        date: msToDateInput(start.getTime(), timeZone),
                        endDate: msToDateInput(start.getTime(), timeZone),
                        startTime: msToTimeInput(start.getTime(), timeZone),
                        endTime: msToTimeInput(end.getTime(), timeZone),
                      });
                    }}
                  />
                  {timed.map((e) => {
                    const people = peopleOf(members, e);
                    const paint = eventPaint(people);
                    const h = heightPx(e.startMs, e.endMs);
                    const w = `calc((100% - 12px) / ${e.cols})`;
                    return (
                      <div
                        key={e.id}
                        style={{
                          position: "absolute",
                          left: `calc(6px + ${e.col} * ${w})`,
                          width: w,
                          top: topPx(e.startMs, timeZone),
                          height: h,
                          zIndex: 2,
                        }}
                      >
                        <EventCard
                          title={e.title}
                          time={formatTimeRange(e.startMs, e.endMs, timeZone)}
                          fill={paint.fill}
                          ink={paint.onFill}
                          multi={paint.multi}
                          height={h}
                          people={people.map((p) => ({
                            name: p.name,
                            surface: chipSurface(p),
                          }))}
                          onClick={() => setSheet(toDraft(e, timeZone))}
                          style={{ height: "100%", minHeight: 0 }}
                        />
                      </div>
                    );
                  })}
                  {isToday ? <NowLine timeZone={timeZone} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {settings?.signedIn && settings.calendarId && timeZone ? (
        <Fab onClick={() => setSheet(createDraft(new Date(), timeZone))} />
      ) : null}
      {sheet ? (
        <EventSheet
          draft={sheet}
          members={members}
          busy={busy}
          onChange={setSheet}
          onClose={() => setSheet(null)}
          onSave={() => save(sheet)}
          onDelete={sheet.id ? () => remove(sheet) : undefined}
        />
      ) : null}
    </div>
  );
}
