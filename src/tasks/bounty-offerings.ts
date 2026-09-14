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
  if (left.kind === "legacy" && right.kind === "legacy") {
    return (
      left.definition === right.definition &&
      left.sourceWindow === right.sourceWindow
    );
  }
  if (left.kind === "legacy") {
    return (
      left.definition === right.definition &&
      ((right.kind === "once" && left.intervalStart === null) ||
        (right.kind === "recurring" &&
          left.intervalStart === right.intervalStart))
    );
  }
  if (right.kind === "legacy") {
    return (
      left.definition === right.definition &&
      ((left.kind === "once" && right.intervalStart === null) ||
        (left.kind === "recurring" &&
          right.intervalStart === left.intervalStart))
    );
  }
  return (
    left.kind === right.kind &&
    left.definition === right.definition &&
    (left.kind === "once" ||
      (right.kind === "recurring" &&
        left.intervalStart === right.intervalStart))
  );
}
