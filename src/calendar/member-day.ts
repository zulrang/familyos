import type { MemberId } from "@/members/members";
import { msToZonedDate } from "@/shared/time";
import { coversDay, formatTimeRange } from "./calendar";
import type { CalEvent } from "./types";

/** Events occupying any part of the member's civil day, including household events. */
export function memberDayEvents(
  events: readonly CalEvent[],
  memberId: MemberId,
  day: Date,
  timeZone: string,
): CalEvent[] {
  return events
    .filter(
      (event) =>
        (event.participantIds.length === 0 ||
          event.participantIds.includes(memberId)) &&
        coversDay(event, day, timeZone),
    )
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        a.startMs - b.startMs ||
        a.endMs - b.endMs ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

/** An overnight event carries both dates so its range is not mistaken for today only. */
export function memberDayTime(event: CalEvent, timeZone: string): string {
  if (event.allDay) return "All day";
  const startDate = msToZonedDate(event.startMs, timeZone);
  const endDate = msToZonedDate(event.endMs, timeZone);
  if (startDate === endDate) {
    return formatTimeRange(event.startMs, event.endMs, timeZone);
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(event.startMs))} – ${formatter.format(new Date(event.endMs))}`;
}
