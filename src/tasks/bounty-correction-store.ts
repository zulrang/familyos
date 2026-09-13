import type { DatabaseSync } from "node:sqlite";
import {
  type HouseholdMember,
  type MemberId,
  memberById,
} from "@/members/members";
import type { BountyCompletionCorrectionCommand } from "./admin-types";
import {
  type BountyCompletionCorrection,
  type BountyCorrectionId,
  type BountyCreditProvenance,
  type ClaimId,
  type ClaimRevision,
  isRecord,
  newBountyCorrectionId,
  nowInstant,
  parseBountyCorrectionId,
  parseClaimId,
  parseClaimRevision,
  parseCompletionId,
  parseInstant,
  parseStarAmount,
} from "./types";

export class BountyCorrectionStoreError extends Error {}

type CorrectedClaimState = "reopened" | "completed" | "released";

export type BountyCorrectionReceipt = Readonly<{
  status: "accepted" | "already-applied";
  result: Readonly<{
    kind: "undone" | "restored" | "reassigned";
    correction: BountyCompletionCorrection;
    claim: Readonly<{
      id: ClaimId;
      revision: ClaimRevision;
      state: CorrectedClaimState;
    }>;
  }>;
}>;

function correctionFromRow(
  row: Record<string, unknown>,
): BountyCompletionCorrection {
  const id = parseBountyCorrectionId(row.id);
  const claim = parseClaimId(row.claim_id);
  const completion = parseCompletionId(row.completion_id);
  const predecessor =
    row.predecessor_id === null
      ? null
      : parseBountyCorrectionId(row.predecessor_id);
  const creditedStars = parseStarAmount(row.credited_stars);
  const at = parseInstant(row.corrected_at);
  const kind =
    row.kind === "undo" || row.kind === "restore" || row.kind === "reassign"
      ? row.kind
      : null;
  const creditProvenance: BountyCreditProvenance | null =
    row.credit_provenance === "recorded" ||
    row.credit_provenance === "legacy-missing"
      ? row.credit_provenance
      : null;
  const fromMember =
    row.from_member === null
      ? null
      : typeof row.from_member === "string" && row.from_member
        ? row.from_member
        : null;
  const toMember =
    row.to_member === null
      ? null
      : typeof row.to_member === "string" && row.to_member
        ? row.to_member
        : null;
  if (
    !id ||
    !claim ||
    !completion ||
    (row.predecessor_id !== null && !predecessor) ||
    creditedStars === null ||
    !at ||
    !kind ||
    !creditProvenance ||
    typeof row.reason !== "string" ||
    !row.reason.trim() ||
    (row.from_member !== null && !fromMember) ||
    (row.to_member !== null && !toMember)
  ) {
    throw new Error("corrupt Bounty completion correction");
  }
  return {
    id,
    kind,
    claim,
    completion,
    predecessor,
    fromMember,
    toMember,
    creditedStars,
    creditProvenance,
    reason: row.reason,
    at,
  };
}

export function loadBountyCompletionCorrections(
  db: DatabaseSync,
): BountyCompletionCorrection[] {
  return db
    .prepare("SELECT * FROM bounty_completion_corrections ORDER BY sequence")
    .all()
    .map((row) => {
      if (!isRecord(row)) throw new Error("corrupt Bounty correction row");
      return correctionFromRow(row);
    });
}

function parseReceipt(raw: unknown): BountyCorrectionReceipt | null {
  if (!isRecord(raw) || raw.status !== "accepted" || !isRecord(raw.result))
    return null;
  const kind =
    raw.result.kind === "undone" ||
    raw.result.kind === "restored" ||
    raw.result.kind === "reassigned"
      ? raw.result.kind
      : null;
  const claimRaw = raw.result.claim;
  const correctionRaw = raw.result.correction;
  if (!kind || !isRecord(claimRaw) || !isRecord(correctionRaw)) return null;
  const claim = parseClaimId(claimRaw.id);
  const revision = parseClaimRevision(claimRaw.revision);
  const state =
    claimRaw.state === "reopened" ||
    claimRaw.state === "completed" ||
    claimRaw.state === "released"
      ? claimRaw.state
      : null;
  let correction: BountyCompletionCorrection;
  try {
    correction = correctionFromRow({
      id: correctionRaw.id,
      kind: correctionRaw.kind,
      claim_id: correctionRaw.claim,
      completion_id: correctionRaw.completion,
      predecessor_id: correctionRaw.predecessor,
      from_member: correctionRaw.fromMember,
      to_member: correctionRaw.toMember,
      credited_stars: correctionRaw.creditedStars,
      credit_provenance: correctionRaw.creditProvenance,
      reason: correctionRaw.reason,
      corrected_at: correctionRaw.at,
    });
  } catch {
    return null;
  }
  return claim && revision !== null && state
    ? {
        status: "accepted",
        result: { kind, correction, claim: { id: claim, revision, state } },
      }
    : null;
}

function priorReceipt(
  db: DatabaseSync,
  command: BountyCompletionCorrectionCommand,
): BountyCorrectionReceipt | null {
  const row = db
    .prepare(
      "SELECT kind, payload, response FROM bounty_correction_receipts WHERE request_id = ?",
    )
    .get(command.requestId);
  if (!row) return null;
  if (row.kind !== command.kind || row.payload !== JSON.stringify(command)) {
    throw new BountyCorrectionStoreError(
      "That request identity has already been used for a different Bounty correction.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(row.response));
  } catch {
    throw new Error("corrupt Bounty correction receipt");
  }
  const receipt = parseReceipt(raw);
  if (!receipt) throw new Error("corrupt Bounty correction receipt");
  return { ...receipt, status: "already-applied" };
}

function saveReceipt(
  db: DatabaseSync,
  command: BountyCompletionCorrectionCommand,
  receipt: BountyCorrectionReceipt,
): void {
  db.prepare(
    `INSERT INTO bounty_correction_receipts
      (request_id, kind, payload, response) VALUES (?, ?, ?, ?)`,
  ).run(
    command.requestId,
    command.kind,
    JSON.stringify(command),
    JSON.stringify(receipt),
  );
}

function balance(db: DatabaseSync, member: MemberId): number {
  return Number(
    db.prepare("SELECT balance FROM star_balances WHERE member = ?").get(member)
      ?.balance ?? 0,
  );
}

function changeBalance(
  db: DatabaseSync,
  member: MemberId,
  delta: number,
): void {
  const next = balance(db, member) + delta;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new BountyCorrectionStoreError(
      delta < 0
        ? "This correction would make the credited member's Star Balance negative. Adjust the balance first."
        : "This correction would put the Star Balance above the supported limit.",
    );
  }
  db.prepare(
    `INSERT INTO star_balances (member, balance) VALUES (?, ?)
     ON CONFLICT(member) DO UPDATE SET balance = excluded.balance`,
  ).run(member, next);
}

function insertCorrection(input: {
  db: DatabaseSync;
  id: BountyCorrectionId;
  kind: BountyCompletionCorrection["kind"];
  claim: ClaimId;
  completion: BountyCompletionCorrection["completion"];
  predecessor: BountyCorrectionId | null;
  fromMember: MemberId | null;
  toMember: MemberId | null;
  creditedStars: BountyCompletionCorrection["creditedStars"];
  creditProvenance: BountyCreditProvenance;
  reason: string;
}): BountyCompletionCorrection {
  const at = nowInstant();
  input.db
    .prepare(
      `INSERT INTO bounty_completion_corrections
        (id, kind, claim_id, completion_id, predecessor_id, from_member,
         to_member, credited_stars, credit_provenance, reason, corrected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.kind,
      input.claim,
      input.completion,
      input.predecessor,
      input.fromMember,
      input.toMember,
      input.creditedStars,
      input.creditProvenance,
      input.reason,
      at,
    );
  return {
    id: input.id,
    kind: input.kind,
    claim: input.claim,
    completion: input.completion,
    predecessor: input.predecessor,
    fromMember: input.fromMember,
    toMember: input.toMember,
    creditedStars: input.creditedStars,
    creditProvenance: input.creditProvenance,
    reason: input.reason,
    at,
  };
}

function effectiveCredit(
  db: DatabaseSync,
  claim: Record<string, unknown>,
): {
  member: MemberId;
  stars: BountyCompletionCorrection["creditedStars"];
  provenance: BountyCreditProvenance;
} {
  const completionId = parseCompletionId(claim.effective_completion_id);
  const claimId = parseClaimId(claim.id);
  if (!completionId || !claimId)
    throw new Error("corrupt effective Bounty credit identity");
  const completion = db
    .prepare("SELECT * FROM bounty_completions WHERE id = ? AND claim_id = ?")
    .get(completionId, claimId);
  if (!isRecord(completion)) throw new Error("corrupt effective completion");
  const stars = parseStarAmount(completion.credited_stars);
  const provenance =
    completion.credit_provenance === "recorded" ||
    completion.credit_provenance === "legacy-missing"
      ? completion.credit_provenance
      : null;
  let member: unknown = completion.member;
  let correctedStars: unknown = completion.credited_stars;
  let correctedProvenance: unknown = completion.credit_provenance;
  if (claim.correction_id !== null) {
    const correctionId = parseBountyCorrectionId(claim.correction_id);
    if (!correctionId) throw new Error("corrupt effective correction identity");
    const correction = db
      .prepare(
        `SELECT to_member, credited_stars, credit_provenance
         FROM bounty_completion_corrections WHERE id = ?`,
      )
      .get(correctionId);
    member = correction?.to_member;
    correctedStars = correction?.credited_stars;
    correctedProvenance = correction?.credit_provenance;
  }
  const effectiveStars = parseStarAmount(correctedStars);
  const effectiveProvenance =
    correctedProvenance === "recorded" ||
    correctedProvenance === "legacy-missing"
      ? correctedProvenance
      : null;
  if (
    typeof member !== "string" ||
    !member ||
    stars === null ||
    !provenance ||
    effectiveStars === null ||
    !effectiveProvenance
  )
    throw new Error("corrupt effective Bounty credit");
  return {
    member,
    stars: effectiveStars,
    provenance: effectiveProvenance,
  };
}

function claimResult(
  row: Record<string, unknown>,
): BountyCorrectionReceipt["result"]["claim"] {
  const id = parseClaimId(row.id);
  const revision = parseClaimRevision(row.revision);
  const state =
    row.state === "reopened" ||
    row.state === "completed" ||
    row.state === "released"
      ? row.state
      : null;
  if (!id || revision === null || !state)
    throw new Error("corrupt corrected Bounty claim");
  return { id, revision, state };
}

export function correctBountyCompletion(input: {
  db: DatabaseSync;
  command: BountyCompletionCorrectionCommand;
  members: readonly HouseholdMember[];
}): BountyCorrectionReceipt {
  const { db, command, members } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = priorReceipt(db, command);
    if (replay) {
      db.exec("COMMIT");
      return replay;
    }
    const row = db
      .prepare("SELECT * FROM bounty_claims WHERE id = ?")
      .get(command.claim);
    if (
      !isRecord(row) ||
      row.revision !== command.revision ||
      row.correction_id !== command.predecessor
    ) {
      throw new BountyCorrectionStoreError(
        "This Bounty completion changed. Refresh before correcting it.",
      );
    }
    const correctionId = newBountyCorrectionId();
    let correction: BountyCompletionCorrection;
    let kind: BountyCorrectionReceipt["result"]["kind"];
    if (command.kind === "undo-bounty-completion") {
      if (
        row.state !== "completed" ||
        row.effective_completion_id !== command.completion
      ) {
        throw new BountyCorrectionStoreError(
          "This Bounty completion can no longer be undone.",
        );
      }
      const credit = effectiveCredit(db, row);
      changeBalance(db, credit.member, -credit.stars);
      correction = insertCorrection({
        db,
        id: correctionId,
        kind: "undo",
        claim: command.claim,
        completion: command.completion,
        predecessor: command.predecessor,
        fromMember: credit.member,
        toMember: null,
        creditedStars: credit.stars,
        creditProvenance: credit.provenance,
        reason: command.reason,
      });
      db.prepare(
        `UPDATE bounty_claims
         SET state = 'reopened', revision = revision + 1,
             effective_completion_id = NULL, restorable_completion_id = ?,
             correction_id = ?
         WHERE id = ?`,
      ).run(command.completion, correction.id, command.claim);
      const claimant = String(row.member);
      if (
        members.find((member) => member.id === claimant)?.status !== "active"
      ) {
        db.prepare(
          `UPDATE bounty_claims
           SET state = 'released', revision = revision + 1,
               effective_completion_id = NULL, restorable_completion_id = NULL,
               correction_id = NULL
           WHERE id = ?`,
        ).run(command.claim);
      }
      kind = "undone";
    } else if (command.kind === "restore-bounty-completion") {
      if (
        row.state !== "reopened" ||
        row.restorable_completion_id !== command.completion
      ) {
        throw new BountyCorrectionStoreError(
          "This Bounty completion can no longer be restored.",
        );
      }
      const undo = db
        .prepare(
          "SELECT * FROM bounty_completion_corrections WHERE id = ? AND kind = 'undo'",
        )
        .get(command.predecessor);
      if (!isRecord(undo) || typeof undo.from_member !== "string")
        throw new Error("corrupt restorable Bounty credit");
      const stars = parseStarAmount(undo.credited_stars);
      const provenance =
        undo.credit_provenance === "recorded" ||
        undo.credit_provenance === "legacy-missing"
          ? undo.credit_provenance
          : null;
      if (stars === null || !provenance)
        throw new Error("corrupt restorable Bounty credit");
      changeBalance(db, undo.from_member, stars);
      correction = insertCorrection({
        db,
        id: correctionId,
        kind: "restore",
        claim: command.claim,
        completion: command.completion,
        predecessor: command.predecessor,
        fromMember: null,
        toMember: undo.from_member,
        creditedStars: stars,
        creditProvenance: provenance,
        reason: command.reason,
      });
      db.prepare(
        `UPDATE bounty_claims
         SET state = 'completed', revision = revision + 1,
             effective_completion_id = ?, restorable_completion_id = NULL,
             correction_id = ?
         WHERE id = ?`,
      ).run(command.completion, correction.id, command.claim);
      kind = "restored";
    } else {
      const targetMember = memberById([...members], command.member);
      if (
        row.state !== "completed" ||
        row.effective_completion_id !== command.completion ||
        !targetMember
      ) {
        throw new BountyCorrectionStoreError(
          "This Bounty completion can no longer be reassigned.",
        );
      }
      const credit = effectiveCredit(db, row);
      if (credit.member === command.member)
        throw new BountyCorrectionStoreError(
          "Choose a different member for this completion.",
        );
      const target = targetMember.id;
      changeBalance(db, credit.member, -credit.stars);
      changeBalance(db, target, credit.stars);
      correction = insertCorrection({
        db,
        id: correctionId,
        kind: "reassign",
        claim: command.claim,
        completion: command.completion,
        predecessor: command.predecessor,
        fromMember: credit.member,
        toMember: target,
        creditedStars: credit.stars,
        creditProvenance: credit.provenance,
        reason: command.reason,
      });
      db.prepare(
        `UPDATE bounty_claims
         SET state = 'completed', revision = revision + 1, correction_id = ?
         WHERE id = ?`,
      ).run(correction.id, command.claim);
      kind = "reassigned";
    }
    const updated = db
      .prepare("SELECT id, revision, state FROM bounty_claims WHERE id = ?")
      .get(command.claim);
    if (!isRecord(updated)) throw new Error("missing corrected Bounty claim");
    const receipt: BountyCorrectionReceipt = {
      status: "accepted",
      result: { kind, correction, claim: claimResult(updated) },
    };
    saveReceipt(db, command, receipt);
    db.exec("COMMIT");
    return receipt;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
