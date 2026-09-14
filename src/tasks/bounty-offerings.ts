import { currentBountyInterval } from "./bounty-calendar";
import type {
  AcceptedOfferingKey,
  BountyDefinition,
  LocalDate,
  OfferingKey,
} from "./types";

export function currentOfferingKey(
  definition: BountyDefinition,
  today: LocalDate,
): OfferingKey | null {
  if (definition.retiredAt !== null) return null;
  if (definition.recurrence.kind === "once") {
    return { kind: "once", definition: definition.id };
  }
  const interval = currentBountyInterval(definition.recurrence, today);
  if (
    interval &&
    definition.offerFrom !== null &&
    interval.start < definition.offerFrom
  ) {
    return null;
  }
  return interval
    ? {
        kind: "recurring",
        definition: definition.id,
        intervalStart: interval.start,
      }
    : null;
}

export function sameOfferingKey(
  left: AcceptedOfferingKey,
  right: AcceptedOfferingKey,
): boolean {
  return (
    left.kind === right.kind &&
    left.definition === right.definition &&
    (left.kind === "once" ||
      (left.kind === "recurring" &&
        right.kind === "recurring" &&
        left.intervalStart === right.intervalStart) ||
      (left.kind === "legacy" &&
        right.kind === "legacy" &&
        left.sourceWindow === right.sourceWindow))
  );
}

export function belongsToOfferingInterval(
  accepted: AcceptedOfferingKey,
  canonical: OfferingKey,
): boolean {
  if (accepted.kind !== "legacy") return sameOfferingKey(accepted, canonical);
  return (
    accepted.definition === canonical.definition &&
    ((canonical.kind === "once" && accepted.intervalStart === null) ||
      (canonical.kind === "recurring" &&
        accepted.intervalStart === canonical.intervalStart))
  );
}
