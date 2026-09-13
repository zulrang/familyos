import { currentOfferingKey, sameOfferingKey } from "./bounty-offerings";
import type { BountyDefinition, ClaimedBounty, LocalDate } from "./types";

export type BountyManagementStatus =
  | "Available"
  | "Claimed"
  | "Completed"
  | "Waiting"
  | "Retired";

export function bountyManagementStatus(input: {
  definition: BountyDefinition;
  claims: readonly ClaimedBounty[];
  today: LocalDate;
}): BountyManagementStatus {
  const { definition, claims, today } = input;
  if (definition.retiredAt !== null) return "Retired";
  const current = currentOfferingKey(definition, today);
  if (!current) return "Waiting";
  const reservation = claims.find(
    (row) =>
      row.state.kind !== "released" &&
      sameOfferingKey(row.claim.offering, current),
  );
  if (reservation?.state.kind === "completed") return "Completed";
  if (reservation) return "Claimed";
  return "Available";
}

const WEEKDAY_LABELS = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
} as const;

export function bountyScheduleLabel(definition: BountyDefinition): string {
  const recurrence = definition.recurrence;
  if (recurrence.kind === "once") return "Once";
  const from = `from ${recurrence.startsOn}`;
  switch (recurrence.cadence.kind) {
    case "daily":
      return `Daily ${from}`;
    case "weekly":
      return `${recurrence.cadence.days.map((day) => WEEKDAY_LABELS[day]).join(", ")} ${from}`;
    case "monthly":
      return `Monthly on day ${recurrence.cadence.day} ${from}`;
    default: {
      const _exhaustive: never = recurrence.cadence;
      return _exhaustive;
    }
  }
}
