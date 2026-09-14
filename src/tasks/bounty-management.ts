import {
  belongsToOfferingInterval,
  currentOfferingKey,
} from "./bounty-offerings";
import type { LegacyBountyCompletionCarrier } from "./legacy-bounty-carrier-types";
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
  carriers: readonly LegacyBountyCompletionCarrier[];
  today: LocalDate;
}): BountyManagementStatus {
  const { definition, claims, carriers, today } = input;
  if (definition.retiredAt !== null) return "Retired";
  const current = currentOfferingKey(definition, today);
  if (!current) return "Waiting";
  const reservations = claims.filter(
    (row) =>
      row.state.kind !== "released" &&
      belongsToOfferingInterval(row.claim.offering, current),
  );
  if (
    reservations.some(
      (row) => row.state.kind === "unfinished" || row.state.kind === "reopened",
    )
  ) {
    return "Claimed";
  }
  if (
    reservations.some((row) => row.state.kind === "completed") ||
    carriers.some(
      (carrier) =>
        carrier.state.kind === "completed" &&
        belongsToOfferingInterval(carrier.offering, current),
    )
  ) {
    return "Completed";
  }
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
