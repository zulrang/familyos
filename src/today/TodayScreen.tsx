"use client";

import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  eventPaint,
  formatTimeRange,
  hoursInView,
  isPastEvent,
  type LaidOut,
  peopleOf,
} from "@/calendar/calendar";
import { PAST_EVENT_OPACITY } from "@/calendar/EventCard";
import {
  type HouseholdCalendar,
  useHouseholdCalendar,
} from "@/calendar/HouseholdCalendar";
import type { CalEvent } from "@/calendar/types";
import {
  type ActiveMember,
  type MemberId,
  memberSurface,
  memberTaskPalette,
  onFillInk,
} from "@/members/members";
import { AppHeader } from "@/shared/AppHeader";
import { formatClock } from "@/shared/time";
import { Avatar } from "@/shared/ui/Avatar";
import { AvatarStack } from "@/shared/ui/AvatarStack";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";
import { useClock } from "@/shared/use-clock";
import { MemberTasks } from "@/tasks/TasksBoard";
import { useTasksWorkspace } from "@/tasks/TasksWorkspace";
import styles from "./TodayScreen.module.css";
import {
  activeEventParticipants,
  allDayEvents,
  DEFAULT_HOUR_PX,
  dayLanes,
  dayRange,
  eventBox,
  gridHeight,
  hourAt,
  hourHeight,
  memberDayLane,
  nowOffset,
  type TodayFilter,
} from "./today";

const EVERYONE: TodayFilter = { kind: "everyone" };
const COLUMNS_VERTICAL_PADDING_PX = 24;
const ONE_LINE_PX = 58;

function laneStyle(member: ActiveMember): CSSProperties {
  const palette = memberTaskPalette(member.color);
  return {
    "--lane-accent": palette.accent,
    "--lane-panel": palette.panel,
    "--lane-header": palette.header,
    "--lane-ink": palette.ink,
    "--lane-control": palette.control,
  } as CSSProperties;
}

function headerDate(day: Date, timeZone: string): string {
  return day.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type DayView = {
  day: Date;
  timeZone: string;
  hourPx: number;
  members: ActiveMember[];
  calendar: HouseholdCalendar;
};

function DayEvent({
  event,
  view,
  lane,
  wide = false,
}: {
  event: LaidOut<CalEvent>;
  view: DayView;
  lane?: ActiveMember;
  wide?: boolean;
}) {
  const { day, timeZone, hourPx, members, calendar } = view;
  const participants = activeEventParticipants(event, members);
  const people = peopleOf(calendar.members, event);
  const paint =
    participants.length === 0
      ? null
      : eventPaint(lane && !wide ? [lane] : people);
  const others = people.filter((person) => person.id !== lane?.id);
  const box = eventBox(event, day, timeZone, hourPx);
  const width = `calc((100% - 12px) / ${event.cols})`;
  return (
    <button
      type="button"
      className={styles.event}
      data-layout={wide || box.height < ONE_LINE_PX ? "line" : "stack"}
      data-everyone={participants.length === 0}
      disabled={!calendar.canMutate}
      onClick={() => calendar.editEvent(event)}
      style={{
        top: box.top,
        height: box.height - 4,
        left: `calc(6px + ${event.col} * ${width})`,
        width,
        background: paint?.fill,
        color: paint?.onFill,
        opacity: isPastEvent(event, day.getTime()) ? PAST_EVENT_OPACITY : 1,
      }}
    >
      <span className={styles.eventTitle}>{event.title}</span>
      <span className={styles.eventTime}>
        {formatTimeRange(event.startMs, event.endMs, timeZone)}
      </span>
      {participants.length === 0 ? (
        wide || !lane ? (
          <span className={styles.eventWho}>
            <Icon name="home" size={18} /> Everyone
          </span>
        ) : null
      ) : others.length > 0 ? (
        <span className={styles.eventWho}>
          <AvatarStack
            size={26}
            people={others.map((person) => ({
              name: person.name,
              surface:
                person.status === "active"
                  ? memberSurface(person.color)
                  : undefined,
            }))}
          />
        </span>
      ) : null}
    </button>
  );
}

function NowLine({ view, now }: { view: DayView; now: Date }) {
  const top = nowOffset(now, view.timeZone, view.hourPx);
  if (top === null) return null;
  return <div className={styles.nowLine} style={{ top }} aria-hidden="true" />;
}

function Lane({
  member,
  events,
  view,
  now,
  wide = false,
}: {
  member: ActiveMember;
  events: LaidOut<CalEvent>[];
  view: DayView;
  now?: Date;
  wide?: boolean;
}) {
  const { day, timeZone, hourPx, calendar } = view;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a lane groups one member's events; it is not a form fieldset
    <div
      role="group"
      aria-label={`${member.name} events`}
      className={styles.lane}
      style={
        {
          ...laneStyle(member),
          height: gridHeight(hourPx),
          "--hour": `${hourPx}px`,
        } as CSSProperties
      }
    >
      {calendar.canMutate ? (
        <button
          type="button"
          className={`fos-hit ${styles.slot}`}
          aria-label={`Add event for ${member.name}`}
          onClick={(e) => {
            const start = hourAt(
              day,
              e.clientY - e.currentTarget.getBoundingClientRect().top,
              timeZone,
              hourPx,
            );
            if (start) calendar.newEvent({ start, memberIds: [member.id] });
          }}
        />
      ) : null}
      {events.map((event) => (
        <DayEvent
          key={event.id}
          event={event}
          view={view}
          lane={member}
          wide={wide}
        />
      ))}
      {now ? <NowLine view={view} now={now} /> : null}
    </div>
  );
}

export function TodayScreen() {
  const now = useClock(15_000);
  const tasks = useTasksWorkspace();
  const calendar = useHouseholdCalendar((zone) => dayRange(now, zone));
  const [chosen, setChosen] = useState<MemberId | null>(null);
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const gridRef = useRef<HTMLDivElement>(null);
  const didScrollNowRef = useRef(false);

  const settings = calendar.settings ?? tasks.settings;
  const timeZone = settings?.timeZone;
  const members = tasks.members;
  const selected = members.find((member) => member.id === chosen) ?? null;
  const filter: TodayFilter = selected
    ? { kind: "member", member: selected.id }
    : EVERYONE;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!timeZone || !grid) return;
    const fit = () =>
      setHourPx(hourHeight(grid.clientHeight - COLUMNS_VERTICAL_PADDING_PX));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [timeZone]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !timeZone || didScrollNowRef.current) return;
    const top = nowOffset(new Date(), timeZone, hourPx);
    if (top !== null) grid.scrollTop = Math.max(0, top - grid.clientHeight / 2);
    didScrollNowRef.current = true;
  }, [timeZone, hourPx]);

  const view: DayView | null = timeZone
    ? { day: now, timeZone, hourPx, members, calendar }
    : null;
  const hours = hoursInView();
  const notice = calendar.notice ?? tasks.error;
  const columns = { "--lanes": members.length } as CSSProperties;

  return (
    <div className={styles.screen}>
      <AppHeader
        title="Today"
        time={
          timeZone ? (
            <>
              <span className={styles.date}>{headerDate(now, timeZone)}</span>
              {formatClock(now, timeZone)}
            </>
          ) : null
        }
        actions={
          <>
            {selected ? (
              <Button onClick={() => setChosen(null)}>Everyone</Button>
            ) : null}
            {calendar.canMutate ? (
              <Button
                onClick={() =>
                  calendar.newEvent({
                    memberIds: selected ? [selected.id] : [],
                  })
                }
              >
                Add event
              </Button>
            ) : null}
            {members.length > 0 ? (
              <Button onClick={() => tasks.newTask(selected?.id)}>
                Add task
              </Button>
            ) : null}
          </>
        }
      />
      {notice ? (
        <div role="alert" className={styles.notice}>
          {notice}
        </div>
      ) : null}
      {view ? (
        <>
          <div className={styles.columns} style={columns}>
            <span />
            {members.map((member) => {
              const progress = tasks.tasks.progress.find(
                (row) => row.member === member.id,
              );
              const done = progress?.done ?? 0;
              const total = progress?.total ?? 0;
              return (
                <button
                  key={member.id}
                  type="button"
                  className={styles.head}
                  style={laneStyle(member)}
                  aria-label={`${member.name}’s day`}
                  aria-pressed={selected?.id === member.id}
                  data-dimmed={selected !== null && selected.id !== member.id}
                  onClick={() =>
                    setChosen(selected?.id === member.id ? null : member.id)
                  }
                >
                  <span className={styles.headName}>
                    <Avatar
                      name={member.name}
                      size={40}
                      ring={false}
                      surface={{
                        soft: member.color,
                        ink: onFillInk(member.color),
                      }}
                    />
                    <span>{member.name}</span>
                  </span>
                  <span className={styles.headProgress}>
                    <progress
                      className={styles.progress}
                      aria-label={`${member.name} completed tasks`}
                      max={total || 1}
                      value={done}
                    />
                    <span>
                      {done}/{total}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <AllDay view={view} filter={filter} />
          <div className={styles.body}>
            <div ref={gridRef} className={styles.grid}>
              {selected ? (
                <div
                  className={styles.columns}
                  style={{ "--lanes": 1 } as CSSProperties}
                >
                  <Hours hours={hours} hourPx={hourPx} />
                  <Lane
                    member={selected}
                    events={memberDayLane(
                      calendar.events,
                      selected,
                      members,
                      now,
                      view.timeZone,
                    )}
                    view={view}
                    now={now}
                    wide
                  />
                </div>
              ) : (
                <EveryoneGrid view={view} now={now} hours={hours} />
              )}
            </div>
            {selected ? (
              <aside className={styles.tasks}>
                <MemberTasks
                  member={selected}
                  tasks={tasks.tasks}
                  {...tasks.actions}
                />
              </aside>
            ) : null}
          </div>
        </>
      ) : null}
      {calendar.editor}
      {tasks.dialogs}
    </div>
  );
}

function Hours({ hours, hourPx }: { hours: string[]; hourPx: number }) {
  return (
    <div className={styles.hours} style={{ height: gridHeight(hourPx) }}>
      {hours.map((label, i) => (
        <span key={label} style={{ top: i * hourPx }}>
          {label}
        </span>
      ))}
    </div>
  );
}

function EveryoneGrid({
  view,
  now,
  hours,
}: {
  view: DayView;
  now: Date;
  hours: string[];
}) {
  const { members, calendar, day, timeZone, hourPx } = view;
  const { bands, lanes } = dayLanes(calendar.events, members, day, timeZone);
  return (
    <div
      className={styles.columns}
      style={{ "--lanes": members.length } as CSSProperties}
    >
      <Hours hours={hours} hourPx={hourPx} />
      {lanes.map((lane) => (
        <Lane
          key={lane.member.id}
          member={lane.member}
          events={lane.events}
          view={view}
        />
      ))}
      {/* biome-ignore lint/a11y/useSemanticElements: groups the events that are for everyone; not a form fieldset */}
      <div role="group" aria-label="Everyone events" className={styles.bands}>
        {bands.map((event) => (
          <DayEvent key={event.id} event={event} view={view} wide />
        ))}
        <NowLine view={view} now={now} />
      </div>
    </div>
  );
}

function AllDay({ view, filter }: { view: DayView; filter: TodayFilter }) {
  const { members, calendar, day, timeZone } = view;
  const events = allDayEvents(calendar.events, members, filter, day, timeZone);
  if (events.length === 0) return null;
  return (
    <div className={styles.allDay}>
      <span className={styles.allDayLabel}>All day</span>
      <div className={styles.allDayBars}>
        {events.map((event) => {
          const participants = activeEventParticipants(event, members);
          const people = peopleOf(calendar.members, event);
          const paint = participants.length === 0 ? null : eventPaint(people);
          return (
            <button
              key={event.id}
              type="button"
              className={styles.allDayBar}
              data-everyone={participants.length === 0}
              disabled={!calendar.canMutate}
              onClick={() => calendar.editEvent(event)}
              style={{ background: paint?.soft }}
            >
              {participants.length === 0 ? (
                <Icon name="home" size={18} />
              ) : (
                <AvatarStack
                  size={24}
                  people={people.map((person) => ({
                    name: person.name,
                    surface:
                      person.status === "active"
                        ? memberSurface(person.color)
                        : undefined,
                  }))}
                />
              )}
              <span>{event.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
