"use client";

import { useEffect, useRef, useState } from "react";
import {
  coversDay,
  eventPaint,
  formatTimeRange,
  gridHeight,
  HOUR_PX,
  heightPx,
  hoursInView,
  isPastEvent,
  isSameDay,
  isWeekend,
  layoutColumns,
  mountGridScrollTop,
  nowLineTop,
  pageFiveDays,
  peopleOf,
  remainingDays,
  slotStart,
  statusEvent,
  timedOnDay,
  topPx,
  viewDays,
  visibleFetchBounds,
  visibleUnderMemberFilter,
  weekdayLabel,
} from "@/calendar/calendar";
import type { CalEvent } from "@/calendar/types";
import {
  LEGACY_TONE_COLORS,
  type Member,
  memberSurface,
} from "@/members/members";
import { AppHeader } from "@/shared/AppHeader";
import { formatClock, zonedDayOfMonth } from "@/shared/time";
import { Button } from "@/shared/ui/Button";
import { Fab } from "@/shared/ui/Fab";
import { IconButton } from "@/shared/ui/IconButton";
import { useClock } from "@/shared/use-clock";
import { AllDayBar } from "./AllDayBar";
import { DayHeader } from "./DayHeader";
import { EventCard } from "./EventCard";
import { useHouseholdCalendar } from "./HouseholdCalendar";
import { MemberChip } from "./MemberChip";
import { NowLine } from "./NowLine";
import { TimeGutter } from "./TimeGutter";

function chipSurface(m: Member) {
  if (m.status !== "active") return memberSurface(LEGACY_TONE_COLORS.sand);
  return memberSurface(m.color);
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
  const [now, setNow] = useState(() => new Date());
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [showChips, setShowChips] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const calendar = useHouseholdCalendar((zone) =>
    visibleFetchBounds(anchor ?? now, zone),
  );
  const { settings, members, events, canMutate } = calendar;
  const timeZone = settings?.timeZone;
  const viewStart = anchor ?? now;
  const days = timeZone ? viewDays(viewStart, timeZone) : [];
  const clock = useClock(60_000);

  useEffect(() => {
    if (!timeZone) return;
    const t = setInterval(() => {
      const n = new Date();
      setNow((p) => (isSameDay(p, n, timeZone) ? p : n));
    }, 60_000);
    return () => clearInterval(t);
  }, [timeZone]);

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

  const status = timeZone ? statusEvent(events, now, timeZone) : null;

  const hours = hoursInView();
  const gh = gridHeight();
  const banner = calendar.notice;

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
            <IconButton
              icon="chevron-left"
              label="Previous five days"
              onClick={() => {
                if (timeZone) setAnchor(pageFiveDays(viewStart, -1, timeZone));
              }}
            />
            <Button size="sm" onClick={() => setAnchor(null)}>
              Today
            </Button>
            <IconButton
              icon="chevron-right"
              label="Next five days"
              onClick={() => {
                if (timeZone) setAnchor(pageFiveDays(viewStart, 1, timeZone));
              }}
            />
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
                  {remainingDays(status, now, timeZone)} days
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
                  background: isWeekend(d, timeZone)
                    ? "var(--surface-weekend)"
                    : undefined,
                }}
              >
                <DayHeader
                  weekday={weekdayLabel(d, timeZone)}
                  date={zonedDayOfMonth(d, timeZone)}
                  today={isSameDay(d, now, timeZone)}
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
                          past={isPastEvent(e, clock.getTime())}
                          style={{
                            height: 30,
                            cursor: canMutate ? "pointer" : "default",
                          }}
                          onClick={
                            canMutate ? () => calendar.editEvent(e) : undefined
                          }
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
              const isToday = isSameDay(d, now, timeZone);
              return (
                <div
                  key={`g-${d.toISOString()}`}
                  style={{
                    minWidth: 0,
                    borderLeft: "1px solid var(--surface-grid-line)",
                    position: "relative",
                    height: gh,
                    backgroundColor: isWeekend(d, timeZone)
                      ? "var(--surface-weekend)"
                      : undefined,
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--surface-grid-line) ${HOUR_PX - 1}px, var(--surface-grid-line) ${HOUR_PX}px)`,
                  }}
                >
                  {canMutate ? (
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
                          e.clientY -
                            e.currentTarget.getBoundingClientRect().top,
                          timeZone,
                        );
                        if (start) calendar.newEvent({ start });
                      }}
                    />
                  ) : null}
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
                          past={isPastEvent(e, clock.getTime())}
                          height={h}
                          people={people.map((p) => ({
                            name: p.name,
                            surface: chipSurface(p),
                          }))}
                          onClick={
                            canMutate ? () => calendar.editEvent(e) : undefined
                          }
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
      {canMutate && timeZone ? (
        <Fab onClick={() => calendar.newEvent()} />
      ) : null}
      {calendar.editor}
    </div>
  );
}
