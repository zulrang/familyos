import type { MemberId } from "@/members/members";
import {
  type BountyCommandId,
  type BountyCorrectionId,
  type BountyCreditProvenance,
  type CompletionId,
  type Instant,
  isRecord,
  type LegacyOfferingKey,
  type LocalDate,
  parseBountyCommandId,
  parseBountyCorrectionId,
  parseCompletionId,
  parseInstant,
  parseLocalDate,
  parseStarAmount,
  parseTaskId,
  parseTaskTitle,
  type StarAmount,
  type TaskId,
  type TaskTitle,
} from "./types";

type Brand<T, B extends string> = T & { readonly __brand: B };

export type LegacyBountyCarrierId = Brand<string, "LegacyBountyCarrierId">;
export type LegacyBountyCarrierRevision = Brand<
  number,
  "LegacyBountyCarrierRevision"
>;

export function parseLegacyBountyCarrierId(
  raw: unknown,
): LegacyBountyCarrierId | null {
  return typeof raw === "string" && raw.length > 0
    ? (raw as LegacyBountyCarrierId)
    : null;
}

export function parseLegacyBountyCarrierRevision(
  raw: unknown,
): LegacyBountyCarrierRevision | null {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? (raw as LegacyBountyCarrierRevision)
    : null;
}

export type LegacyBountyCompletion = Readonly<{
  id: CompletionId;
  carrier: LegacyBountyCarrierId;
  by: MemberId;
  at: Instant;
  creditedStars: StarAmount;
  creditProvenance: BountyCreditProvenance;
}>;

type LegacyBountyCompletionCorrectionFields = Readonly<{
  id: BountyCorrectionId;
  carrier: LegacyBountyCarrierId;
  completion: CompletionId;
  predecessor: BountyCorrectionId | null;
  creditedStars: StarAmount;
  creditProvenance: BountyCreditProvenance;
  reason: string;
  at: Instant;
}>;

/** Restore is historical import data only; no new Restore command exists. */
export type LegacyBountyCompletionCorrection =
  LegacyBountyCompletionCorrectionFields &
    (
      | Readonly<{ kind: "undo"; fromMember: MemberId; toMember: null }>
      | Readonly<{ kind: "restore"; fromMember: null; toMember: MemberId }>
      | Readonly<{
          kind: "reassign";
          fromMember: MemberId;
          toMember: MemberId;
        }>
    );

type LegacyBountyCompletionCarrierFields = Readonly<{
  kind: "legacy-bounty-completion-carrier";
  id: LegacyBountyCarrierId;
  sourceTask: TaskId;
  sourceWindow: LocalDate;
  definition: TaskId;
  offering: LegacyOfferingKey;
  /** Current display title of the mapped Bounty Definition. */
  title: TaskTitle;
  revision: LegacyBountyCarrierRevision;
  history: readonly LegacyBountyCompletionCorrection[];
}>;

export type LegacyBountyCompletionCarrier =
  LegacyBountyCompletionCarrierFields &
    Readonly<{
      state:
        | Readonly<{
            kind: "completed";
            effectiveCompletion: LegacyBountyCompletion;
            creditedTo: MemberId;
            correction: BountyCorrectionId | null;
          }>
        | Readonly<{
            kind: "released";
            undoneCompletion: LegacyBountyCompletion;
            correction: BountyCorrectionId;
          }>;
    }>;

type LegacyBountyCorrectionCommandFields = Readonly<{
  requestId: BountyCommandId;
  carrier: LegacyBountyCarrierId;
  revision: LegacyBountyCarrierRevision;
  completion: CompletionId;
  predecessor: BountyCorrectionId | null;
  reason: string;
}>;

export type LegacyBountyCompletionCorrectionCommand =
  | (LegacyBountyCorrectionCommandFields &
      Readonly<{ kind: "undo-legacy-bounty-completion" }>)
  | (LegacyBountyCorrectionCommandFields &
      Readonly<{
        kind: "reassign-legacy-bounty-completion";
        member: MemberId;
      }>);

export type LegacyBountyCorrectionReceipt = Readonly<{
  status: "accepted" | "already-applied";
  result:
    | Readonly<{
        kind: "legacy-bounty-completion-undone";
        carrier: LegacyBountyCarrierId;
        revision: LegacyBountyCarrierRevision;
      }>
    | Readonly<{
        kind: "legacy-bounty-completion-reassigned";
        carrier: LegacyBountyCarrierId;
        revision: LegacyBountyCarrierRevision;
      }>;
}>;

export function parseLegacyBountyCompletionCorrectionCommand(
  raw: unknown,
): LegacyBountyCompletionCorrectionCommand | null {
  if (
    !isRecord(raw) ||
    (raw.kind !== "undo-legacy-bounty-completion" &&
      raw.kind !== "reassign-legacy-bounty-completion")
  ) {
    return null;
  }
  const requestId = parseBountyCommandId(raw.requestId);
  const carrier = parseLegacyBountyCarrierId(raw.carrier);
  const revision = parseLegacyBountyCarrierRevision(raw.revision);
  const completion = parseCompletionId(raw.completion);
  const predecessor =
    raw.predecessor === null ? null : parseBountyCorrectionId(raw.predecessor);
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  const keys = [
    "kind",
    "requestId",
    "carrier",
    "revision",
    "completion",
    "predecessor",
    "reason",
    ...(raw.kind === "reassign-legacy-bounty-completion" ? ["member"] : []),
  ];
  if (
    !Object.keys(raw).every((key) => keys.includes(key)) ||
    !requestId ||
    !carrier ||
    revision === null ||
    !completion ||
    (raw.predecessor !== null && !predecessor) ||
    !reason
  ) {
    return null;
  }
  const fields = {
    requestId,
    carrier,
    revision,
    completion,
    predecessor,
    reason,
  };
  if (raw.kind === "undo-legacy-bounty-completion") {
    return { kind: raw.kind, ...fields };
  }
  return typeof raw.member === "string" && raw.member
    ? { kind: raw.kind, ...fields, member: raw.member }
    : null;
}

export function parseLegacyBountyCorrectionReceipt(
  raw: unknown,
): LegacyBountyCorrectionReceipt | null {
  if (!isRecord(raw) || raw.status !== "accepted" || !isRecord(raw.result)) {
    return null;
  }
  const kind =
    raw.result.kind === "legacy-bounty-completion-undone" ||
    raw.result.kind === "legacy-bounty-completion-reassigned"
      ? raw.result.kind
      : null;
  const carrier = parseLegacyBountyCarrierId(raw.result.carrier);
  const revision = parseLegacyBountyCarrierRevision(raw.result.revision);
  return kind && carrier && revision !== null
    ? { status: "accepted", result: { kind, carrier, revision } }
    : null;
}

export function parseLegacyBountyCarrierIdentity(raw: {
  id: unknown;
  sourceTask: unknown;
  sourceWindow: unknown;
  definition: unknown;
  title: unknown;
  revision: unknown;
}): Omit<
  LegacyBountyCompletionCarrierFields,
  "kind" | "history" | "offering"
> | null {
  const id = parseLegacyBountyCarrierId(raw.id);
  const sourceTask = parseTaskId(raw.sourceTask);
  const sourceWindow = parseLocalDate(raw.sourceWindow);
  const definition = parseTaskId(raw.definition);
  const title = parseTaskTitle(raw.title);
  const revision = parseLegacyBountyCarrierRevision(raw.revision);
  return id &&
    sourceTask &&
    sourceWindow &&
    definition &&
    title &&
    revision !== null
    ? { id, sourceTask, sourceWindow, definition, title, revision }
    : null;
}

export function parseLegacyBountyCompletionFields(raw: {
  id: unknown;
  carrier: unknown;
  by: unknown;
  at: unknown;
  creditedStars: unknown;
  creditProvenance: unknown;
}): LegacyBountyCompletion | null {
  const id = parseCompletionId(raw.id);
  const carrier = parseLegacyBountyCarrierId(raw.carrier);
  const creditedStars = parseStarAmount(raw.creditedStars);
  const at = parseInstant(raw.at);
  const creditProvenance: BountyCreditProvenance | null =
    raw.creditProvenance === "recorded" ||
    raw.creditProvenance === "legacy-missing"
      ? raw.creditProvenance
      : null;
  return id &&
    carrier &&
    typeof raw.by === "string" &&
    raw.by &&
    at &&
    creditedStars !== null &&
    creditProvenance
    ? {
        id,
        carrier,
        by: raw.by,
        at,
        creditedStars,
        creditProvenance,
      }
    : null;
}
