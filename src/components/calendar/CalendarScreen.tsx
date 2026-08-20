"use client";

import { useEffect, useRef, useState } from "react";
import {
  coversDay,
  eventTone,
  formatClock,
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
  startOfDay,
  statusEvent,
  timedOnDay,
  topPx,
  weekDays,
  weekdayLabel,
} from "@/lib/calendar";
import { redirectIfPairingRequired } from "@/lib/display-client";
import { activeMembers, legacyToneForColor } from "@/lib/members";
import type { CalEvent, Member, MemberTone, PublicSettings } from "@/lib/types";
import { Button } from "../core/Button";
import { Fab } from "../core/Fab";
import { AppHeader } from "../nav/AppHeader";
import { AllDayBar } from "./AllDayBar";
import { DayHeader } from "./DayHeader";
import { EventCard } from "./EventCard";
import { type EventDraft, EventSheet, whoFromIds } from "./EventSheet";
import { MemberChip } from "./MemberChip";
import { NowLine } from "./NowLine";
import { TimeGutter } from "./TimeGutter";

function chipTone(m: Member): MemberTone {
  if (m.status !== "active") return "sand";
  return legacyToneForColor(m.color) ?? "sand";
}

function toDraft(ev: CalEvent, members: Member[]): EventDraft {
  const people = peopleOf(members, ev);
  const endInclusive = ev.allDay ? ev.endMs - 86400000 : ev.endMs;
  return {
    id: ev.id,
    title: ev.title,
    allDay: ev.allDay,
    date: msToDateInput(ev.startMs),
    endDate: msToDateInput(endInclusive),
    startTime: msToTimeInput(ev.startMs),
    endTime: msToTimeInput(ev.endMs),
    memberIds: people.map((p) => p.id),
    who: whoFromIds(people.map((p) => p.id)),
    recurringEventId: ev.recurringEventId,
    scope: "this",
  };
}

function createDraft(now: Date): EventDraft {
  const n = nextHour(now);
  return {
    title: "",
    allDay: false,
    date: msToDateInput(n.startMs),
    endDate: msToDateInput(n.startMs),
    startTime: msToTimeInput(n.startMs),
    endTime: msToTimeInput(n.endMs),
    memberIds: [],
    who: "none",
    scope: "this",
  };
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now ? formatClock(now) : null;
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

  const days = weekDays(today);
  const members = settings?.members ?? [];
  const from = startOfDay(days[0]).toISOString();
  const to = new Date(
    startOfDay(days[days.length - 1]).getTime() + 86400000,
  ).toISOString();

  async function load() {
    const sRes = await fetch("/api/settings");
    if (await redirectIfPairingRequired(sRes)) return;
    const s = (await sRes.json()) as PublicSettings;
    setSettings(s);
    if (!s.signedIn || !s.calendarId) {
      setEvents([]);
      return;
    }
    const eRes = await fetch(
      `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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
    const t = setInterval(() => {
      const n = new Date();
      setToday((p) => (isSameDay(p, n) ? p : n));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the visible week bounds change
  useEffect(() => {
    load().catch(() => setError("Could not load calendar."));
  }, [from, to]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const base = mountGridScrollTop(savedGridScroll, new Date());
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
  }, []);

  const visible = (ev: CalEvent) => {
    const people = peopleOf(members, ev);
    if (!people.length) return true;
    return people.some((p) => !off[p.id]);
  };

  const status = statusEvent(events, today);

  async function save(draft: EventDraft) {
    setBusy(true);
    try {
      const selected = members.filter((m) => draft.memberIds.includes(m.id));
      const startMs = draft.allDay
        ? fromDateOnly(draft.date)
        : fromDateAndTime(draft.date, draft.startTime);
      const endMs = draft.allDay
        ? fromDateOnly(draft.endDate) + 86400000
        : fromDateAndTime(draft.date, draft.endTime);
      const body = {
        title: draft.title.trim() || "Busy",
        allDay: draft.allDay,
        startMs,
        endMs,
        tones: selected
          .filter((m) => m.status === "active")
          .map((m) => legacyToneForColor(m.color) ?? "sand"),
        attendeeEmails: [],
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
        time={<LiveClock />}
        actions={
          <>
            <Button
              icon="columns-3"
              onClick={() => {
                if (gridRef.current) {
                  const headerH = headerRef.current?.offsetHeight ?? 0;
                  gridRef.current.scrollTop = Math.max(
                    0,
                    nowLineTop(new Date()) - HOUR_PX + headerH,
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
              <span style={{ color: "var(--text-muted)" }}>
                {remainingDays(status, today)} days
              </span>
            </span>
          ) : null}
          {members.map((p) => (
            <MemberChip
              key={p.id}
              name={p.name}
              tone={chipTone(p)}
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
                weekday={weekdayLabel(d)}
                date={d.getDate()}
                today={isSameDay(d, today)}
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
                  .filter((e) => e.allDay && coversDay(e, d) && visible(e))
                  .map((e) => {
                    const people = peopleOf(members, e);
                    const { tone, multi } = eventTone(people);
                    return (
                      <AllDayBar
                        key={e.id}
                        label={e.title}
                        tone={tone}
                        multi={multi}
                        style={{ height: 30, cursor: "pointer" }}
                        onClick={() => setSheet(toDraft(e, members))}
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
              events.filter((e) => timedOnDay(e, d) && visible(e)),
            );
            const isToday = isSameDay(d, today);
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
                  aria-label={`Add event ${weekdayLabel(d)}`}
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
                    );
                    if (!start) return;
                    const end = new Date(start.getTime() + 3600000);
                    setSheet({
                      ...createDraft(start),
                      date: msToDateInput(start.getTime()),
                      endDate: msToDateInput(start.getTime()),
                      startTime: msToTimeInput(start.getTime()),
                      endTime: msToTimeInput(end.getTime()),
                    });
                  }}
                />
                {timed.map((e) => {
                  const people = peopleOf(members, e);
                  const { tone, multi } = eventTone(people);
                  const h = heightPx(e.startMs, e.endMs);
                  const w = `calc((100% - 12px) / ${e.cols})`;
                  return (
                    <div
                      key={e.id}
                      style={{
                        position: "absolute",
                        left: `calc(6px + ${e.col} * ${w})`,
                        width: w,
                        top: topPx(e.startMs),
                        height: h,
                        zIndex: 2,
                      }}
                    >
                      <EventCard
                        title={e.title}
                        time={formatTimeRange(e.startMs, e.endMs)}
                        tone={tone}
                        multi={multi}
                        height={h}
                        people={people.map((p) => ({
                          name: p.name,
                          tone: chipTone(p),
                        }))}
                        onClick={() => setSheet(toDraft(e, members))}
                        style={{ height: "100%", minHeight: 0 }}
                      />
                    </div>
                  );
                })}
                {isToday ? <NowLine /> : null}
              </div>
            );
          })}
        </div>
      </div>
      {settings?.signedIn && settings.calendarId ? (
        <Fab onClick={() => setSheet(createDraft(new Date()))} />
      ) : null}
      {sheet ? (
        <EventSheet
          draft={sheet}
          members={activeMembers(members)}
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
