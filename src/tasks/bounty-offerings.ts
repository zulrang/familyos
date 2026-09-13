import { currentBountyInterval } from "./bounty-calendar";
import type { BountyDefinition, LocalDate, OfferingKey } from "./types";

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
  left: OfferingKey,
  right: OfferingKey,
): boolean {
  return (
    left.kind === right.kind &&
    left.definition === right.definition &&
    (left.kind === "once" ||
      (right.kind === "recurring" &&
        left.intervalStart === right.intervalStart))
  );
}
