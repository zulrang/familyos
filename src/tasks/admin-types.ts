import {
  type BountyCommandId,
  type BountyCompletion,
  type BountyCompletionCorrection,
  type BountyCorrectionId,
  type BountyDefinition,
  type ClaimedBounty,
  type CreateBountyDraft,
  type CreateTaskDraft,
  type DefinitionRevision,
  type Instant,
  isRecord,
  type LegacyTaskDefinition,
  type LocalDate,
  parseBountyCommandId,
  parseBountyCorrectionId,
  parseClaimId,
  parseClaimRevision,
  parseCompletionId,
  parseCreateBountyDraft,
  parseCreateTaskDraft,
  parseDefinitionRevision,
  parseLocalDate,
  parseStarAmount,
  parseTaskId,
  parseTaskTitle,
  type StarAdjustment,
  type StarBalance,
  type TaskEvent,
  type TaskId,
} from "./types";

export type AssignedChoreDraft = Omit<
  CreateTaskDraft,
  "type" | "assignment"
> & {
  type: "chore";
  assignment: Exclude<CreateTaskDraft["assignment"], { kind: "open" }>;
};

export type DefinitionReplacementCommand =
  | Readonly<{
      kind: "replace-definition";
      requestId: BountyCommandId;
      source: Readonly<{
        kind: "bounty";
        definition: TaskId;
        revision: DefinitionRevision;
      }>;
      replacement:
        | CreateBountyDraft
        | Readonly<{ kind: "assigned" } & AssignedChoreDraft>;
    }>
  | Readonly<{
      kind: "replace-definition";
      requestId: BountyCommandId;
      source: Readonly<{ kind: "assigned"; definition: TaskId }>;
      replacement: CreateBountyDraft;
    }>;

export type TaskAdminRead = {
  definitions: LegacyTaskDefinition[];
  bountyDefinitions: BountyDefinition[];
  bountyClaims: ClaimedBounty[];
  bountyCompletions: BountyCompletion[];
  bountyCompletionCorrections: BountyCompletionCorrection[];
  events: TaskEvent[];
  originalEvents: TaskEvent[];
  corrections: CompletionCorrection[];
  adjustments: StarAdjustment[];
  balances: StarBalance[];
  today: LocalDate;
};

export type BountyCompletionCorrectionCommand =
  | Readonly<{
      kind: "undo-bounty-completion";
      requestId: BountyCommandId;
      claim: ClaimedBounty["claim"]["id"];
      revision: ClaimedBounty["revision"];
      completion: BountyCompletionCorrection["completion"];
      predecessor: BountyCorrectionId | null;
      reason: string;
    }>
  | Readonly<{
      kind: "restore-bounty-completion";
      requestId: BountyCommandId;
      claim: ClaimedBounty["claim"]["id"];
      revision: ClaimedBounty["revision"];
      completion: BountyCompletionCorrection["completion"];
      predecessor: BountyCorrectionId | null;
      reason: string;
    }>
  | Readonly<{
      kind: "reassign-bounty-completion";
      requestId: BountyCommandId;
      claim: ClaimedBounty["claim"]["id"];
      revision: ClaimedBounty["revision"];
      completion: BountyCompletionCorrection["completion"];
      predecessor: BountyCorrectionId | null;
      member: string;
      reason: string;
    }>;

export type BountyDefinitionDraft = Readonly<{
  title: BountyDefinition["title"];
  stars: BountyDefinition["stars"];
}>;

export type BountyAdminCommand =
  | Readonly<{
      kind: "edit-bounty";
      requestId: BountyCommandId;
      definition: TaskId;
      revision: DefinitionRevision;
      draft: BountyDefinitionDraft;
    }>
  | Readonly<{
      kind: "retire-bounty";
      requestId: BountyCommandId;
      definition: TaskId;
      revision: DefinitionRevision;
    }>;

export type CompletionCorrection = {
  id: string;
  task: TaskId;
  window: LocalDate;
  by: string | null; // null retracts the completion; an ID restores/reassigns it.
  reason: string;
  at: Instant;
  previous: string | null;
};

export type TaskAdminCommand =
  | { kind: "create"; id: string; draft: CreateTaskDraft }
  | { kind: "edit"; task: TaskId; draft: CreateTaskDraft }
  | { kind: "retire"; task: TaskId }
  | BountyAdminCommand
  | BountyCompletionCorrectionCommand
  | DefinitionReplacementCommand
  | { kind: "correct"; correction: Omit<CompletionCorrection, "at"> }
  | {
      kind: "adjust-stars";
      id: string;
      member: string;
      delta: number;
      reason: string;
    };

function parseLegalAssignedDraft(raw: unknown): CreateTaskDraft | null {
  const draft = parseCreateTaskDraft(raw);
  return draft?.type === "routine" && draft.assignment.kind === "open"
    ? null
    : draft;
}

export function parseTaskAdminCommand(raw: unknown): TaskAdminCommand | null {
  if (!isRecord(raw)) return null;
  const id =
    typeof raw.id === "string" && /^[a-f0-9-]{32,36}$/.test(raw.id)
      ? raw.id
      : null;
  if (raw.kind === "create") {
    const draft = parseLegalAssignedDraft(raw.draft);
    return id && draft ? { kind: "create", id, draft } : null;
  }
  if (raw.kind === "adjust-stars") {
    return id &&
      typeof raw.member === "string" &&
      raw.member &&
      typeof raw.delta === "number" &&
      Number.isSafeInteger(raw.delta) &&
      raw.delta !== 0 &&
      typeof raw.reason === "string" &&
      raw.reason.trim()
      ? {
          kind: "adjust-stars",
          id,
          member: raw.member,
          delta: raw.delta,
          reason: raw.reason.trim(),
        }
      : null;
  }
  if (
    raw.kind === "undo-bounty-completion" ||
    raw.kind === "restore-bounty-completion" ||
    raw.kind === "reassign-bounty-completion"
  ) {
    const requestId = parseBountyCommandId(raw.requestId);
    const claim = parseClaimId(raw.claim);
    const revision = parseClaimRevision(raw.revision);
    const completion = parseCompletionId(raw.completion);
    const predecessor =
      raw.predecessor === null
        ? null
        : parseBountyCorrectionId(raw.predecessor);
    const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    const keys = [
      "kind",
      "requestId",
      "claim",
      "revision",
      "completion",
      "predecessor",
      "reason",
      ...(raw.kind === "reassign-bounty-completion" ? ["member"] : []),
    ];
    if (
      !Object.keys(raw).every((key) => keys.includes(key)) ||
      !requestId ||
      !claim ||
      revision === null ||
      !completion ||
      (raw.predecessor !== null && !predecessor) ||
      !reason
    ) {
      return null;
    }
    if (raw.kind === "reassign-bounty-completion") {
      return typeof raw.member === "string" && raw.member
        ? {
            kind: raw.kind,
            requestId,
            claim,
            revision,
            completion,
            predecessor,
            member: raw.member,
            reason,
          }
        : null;
    }
    return {
      kind: raw.kind,
      requestId,
      claim,
      revision,
      completion,
      predecessor,
      reason,
    };
  }
  if (raw.kind === "edit-bounty" || raw.kind === "retire-bounty") {
    const requestId = parseBountyCommandId(raw.requestId);
    const definition = parseTaskId(raw.definition);
    const revision = parseDefinitionRevision(raw.revision);
    if (!requestId || !definition || revision === null) return null;
    if (raw.kind === "retire-bounty") {
      return Object.keys(raw).every((key) =>
        ["kind", "requestId", "definition", "revision"].includes(key),
      )
        ? { kind: "retire-bounty", requestId, definition, revision }
        : null;
    }
    if (
      !Object.keys(raw).every((key) =>
        ["kind", "requestId", "definition", "revision", "draft"].includes(key),
      ) ||
      !isRecord(raw.draft) ||
      !Object.keys(raw.draft).every((key) => ["title", "stars"].includes(key))
    ) {
      return null;
    }
    const title = parseTaskTitle(raw.draft.title);
    const stars = parseStarAmount(raw.draft.stars);
    return title && stars !== null
      ? {
          kind: "edit-bounty",
          requestId,
          definition,
          revision,
          draft: { title, stars },
        }
      : null;
  }
  if (raw.kind === "replace-definition") {
    if (
      !Object.keys(raw).every((key) =>
        ["kind", "requestId", "source", "replacement"].includes(key),
      ) ||
      !isRecord(raw.source) ||
      !isRecord(raw.replacement)
    ) {
      return null;
    }
    const requestId = parseBountyCommandId(raw.requestId);
    const definition = parseTaskId(raw.source.definition);
    if (!requestId || !definition) return null;
    const replacement = (() => {
      if (raw.replacement.kind === "bounty") {
        return parseCreateBountyDraft(raw.replacement);
      }
      if (raw.replacement.kind !== "assigned") return null;
      const { kind: _kind, ...candidate } = raw.replacement;
      const assigned = parseLegalAssignedDraft(candidate);
      return assigned ? ({ kind: "assigned", ...assigned } as const) : null;
    })();
    if (!replacement) return null;
    if (raw.source.kind === "assigned") {
      return Object.keys(raw.source).every((key) =>
        ["kind", "definition"].includes(key),
      ) && replacement.kind === "bounty"
        ? {
            kind: "replace-definition",
            requestId,
            source: { kind: "assigned", definition },
            replacement,
          }
        : null;
    }
    const revision = parseDefinitionRevision(raw.source.revision);
    if (
      raw.source.kind !== "bounty" ||
      revision === null ||
      !Object.keys(raw.source).every((key) =>
        ["kind", "definition", "revision"].includes(key),
      )
    ) {
      return null;
    }
    if (replacement.kind === "bounty") {
      return {
        kind: "replace-definition",
        requestId,
        source: { kind: "bounty", definition, revision },
        replacement,
      };
    }
    if (
      replacement.type !== "chore" ||
      replacement.assignment.kind === "open"
    ) {
      return null;
    }
    return {
      kind: "replace-definition",
      requestId,
      source: { kind: "bounty", definition, revision },
      replacement: {
        kind: "assigned",
        title: replacement.title,
        type: "chore",
        recurrence: replacement.recurrence,
        assignment: replacement.assignment,
        time: replacement.time,
        stars: replacement.stars,
      },
    };
  }
  const task = parseTaskId(raw.task);
  if (!task) return null;
  if (raw.kind === "retire") return { kind: "retire", task };
  if (raw.kind === "edit") {
    const draft = parseCreateTaskDraft(raw.draft);
    return draft ? { kind: "edit", task, draft } : null;
  }
  const window = parseLocalDate(raw.window);
  if (
    raw.kind === "correct" &&
    id &&
    window &&
    (raw.by === null || (typeof raw.by === "string" && raw.by.length > 0)) &&
    (raw.previous === null || typeof raw.previous === "string") &&
    typeof raw.reason === "string" &&
    raw.reason.trim()
  ) {
    return {
      kind: "correct",
      correction: {
        id,
        task,
        window,
        by: raw.by,
        previous: raw.previous,
        reason: raw.reason.trim(),
      },
    };
  }
  return null;
}
