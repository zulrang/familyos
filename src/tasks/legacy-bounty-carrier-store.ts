import type { DatabaseSync } from "node:sqlite";
import {
  type HouseholdMember,
  type MemberId,
  memberById,
} from "@/members/members";
import {
  type LegacyBountyCompletion,
  type LegacyBountyCompletionCarrier,
  type LegacyBountyCompletionCorrection,
  type LegacyBountyCompletionCorrectionCommand,
  type LegacyBountyCorrectionReceipt,
  parseLegacyBountyCarrierId,
  parseLegacyBountyCarrierIdentity,
  parseLegacyBountyCarrierRevision,
  parseLegacyBountyCompletionFields,
  parseLegacyBountyCorrectionReceipt,
} from "./legacy-bounty-carrier-types";
import {
  type BountyCorrectionId,
  type BountyCreditProvenance,
  isRecord,
  newBountyCorrectionId,
  nowInstant,
  parseBountyCorrectionId,
  parseCompletionId,
  parseInstant,
  parseLocalDate,
  parseStarAmount,
} from "./types";

export class LegacyBountyCarrierStoreError extends Error {}

function completionFromRow(
  row: Record<string, unknown>,
): LegacyBountyCompletion {
  const completion = parseLegacyBountyCompletionFields({
    id: row.id,
    carrier: row.subject_id,
    by: row.member,
    at: row.completed_at,
    creditedStars: row.credited_stars,
    creditProvenance: row.credit_provenance,
  });
  if (!completion || row.origin !== "legacy")
    throw new Error("corrupt legacy Bounty completion");
  return completion;
}

function correctionFromRow(
  row: Record<string, unknown>,
): LegacyBountyCompletionCorrection {
  const id = parseBountyCorrectionId(row.id);
  const carrier = parseLegacyBountyCarrierId(row.subject_id);
  const completion = parseCompletionId(row.completion_id);
  const predecessor =
    row.predecessor_id === null
      ? null
      : parseBountyCorrectionId(row.predecessor_id);
  const creditedStars = parseStarAmount(row.credited_stars);
  const at = parseInstant(row.corrected_at);
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
    !carrier ||
    !completion ||
    (row.predecessor_id !== null && !predecessor) ||
    creditedStars === null ||
    !at ||
    !creditProvenance ||
    typeof row.reason !== "string" ||
    !row.reason.trim() ||
    (row.from_member !== null && !fromMember) ||
    (row.to_member !== null && !toMember)
  ) {
    throw new Error("corrupt legacy Bounty completion correction");
  }
  const fields = {
    id,
    carrier,
    completion,
    predecessor,
    creditedStars,
    creditProvenance,
    reason: row.reason,
    at,
  };
  if (row.kind === "undo" && fromMember && toMember === null)
    return { ...fields, kind: row.kind, fromMember, toMember };
  if (row.kind === "restore" && fromMember === null && toMember)
    return { ...fields, kind: row.kind, fromMember, toMember };
  if (row.kind === "reassign" && fromMember && toMember)
    return { ...fields, kind: row.kind, fromMember, toMember };
  throw new Error("corrupt legacy Bounty completion correction");
}

function loadCompletion(
  db: DatabaseSync,
  carrier: LegacyBountyCompletionCarrier["id"],
  completion: unknown,
): LegacyBountyCompletion {
  const id = parseCompletionId(completion);
  if (!id) throw new Error("corrupt legacy Bounty completion identity");
  const row = db
    .prepare("SELECT * FROM bounty_completions WHERE id = ? AND subject_id = ?")
    .get(id, carrier);
  if (!isRecord(row)) throw new Error("missing legacy Bounty completion");
  return completionFromRow(row);
}

function loadHistory(
  db: DatabaseSync,
  carrier: LegacyBountyCompletionCarrier["id"],
): LegacyBountyCompletionCorrection[] {
  return db
    .prepare(
      `SELECT * FROM bounty_completion_corrections
       WHERE subject_id = ? ORDER BY sequence`,
    )
    .all(carrier)
    .map((row) => {
      if (!isRecord(row))
        throw new Error("corrupt legacy Bounty correction row");
      return correctionFromRow(row);
    });
}

function validateHistoryChain(
  history: readonly LegacyBountyCompletionCorrection[],
  completion: LegacyBountyCompletion["id"],
): BountyCorrectionId | null {
  let predecessor: BountyCorrectionId | null = null;
  for (const correction of history) {
    if (
      correction.completion !== completion ||
      correction.predecessor !== predecessor
    ) {
      throw new Error("corrupt legacy Bounty correction history");
    }
    predecessor = correction.id;
  }
  return predecessor;
}

function carrierFromRow(
  db: DatabaseSync,
  row: Record<string, unknown>,
): LegacyBountyCompletionCarrier {
  const identity = parseLegacyBountyCarrierIdentity({
    id: row.id,
    sourceTask: row.source_task_id,
    sourceWindow: row.source_window,
    definition: row.definition_id,
    title: row.title,
    revision: row.revision,
  });
  if (!identity) throw new Error("corrupt legacy Bounty carrier identity");
  const intervalStart =
    row.interval_start === null ? null : parseLocalDate(row.interval_start);
  if (
    row.offering_kind !== "legacy" ||
    row.offering_definition !== identity.definition ||
    row.offering_source_window !== identity.sourceWindow ||
    (row.interval_start !== null && !intervalStart)
  ) {
    throw new Error("corrupt legacy Bounty carrier offering");
  }
  const offering = {
    kind: "legacy" as const,
    definition: identity.definition,
    sourceWindow: identity.sourceWindow,
    intervalStart,
  };
  const history = loadHistory(db, identity.id);
  if (row.state === "completed") {
    const effectiveCompletion = loadCompletion(
      db,
      identity.id,
      row.effective_completion_id,
    );
    const correction =
      row.correction_id === null
        ? null
        : parseBountyCorrectionId(row.correction_id);
    const latest = correction
      ? history.find((entry) => entry.id === correction)
      : null;
    const creditedTo = latest ? latest.toMember : effectiveCompletion.by;
    if (
      (row.correction_id !== null && !correction) ||
      validateHistoryChain(history, effectiveCompletion.id) !== correction ||
      (correction && (!latest || latest.kind === "undo"))
    ) {
      throw new Error("corrupt effective legacy Bounty correction");
    }
    if (!creditedTo)
      throw new Error("corrupt effective legacy Bounty creditor");
    return {
      kind: "legacy-bounty-completion-carrier",
      ...identity,
      offering,
      history,
      state: {
        kind: "completed",
        effectiveCompletion,
        creditedTo,
        correction,
      },
    };
  }
  if (row.state === "released" && row.effective_completion_id === null) {
    const correction = parseBountyCorrectionId(row.correction_id);
    const latest = correction
      ? history.find((entry) => entry.id === correction)
      : null;
    if (!correction || !latest || latest.kind !== "undo")
      throw new Error("corrupt released legacy Bounty carrier");
    const undoneCompletion = loadCompletion(db, identity.id, latest.completion);
    if (validateHistoryChain(history, undoneCompletion.id) !== correction)
      throw new Error("corrupt released legacy Bounty correction history");
    return {
      kind: "legacy-bounty-completion-carrier",
      ...identity,
      offering,
      history,
      state: {
        kind: "released",
        undoneCompletion,
        correction,
      },
    };
  }
  throw new Error("corrupt legacy Bounty carrier state");
}

export function loadLegacyBountyCompletionCarriers(
  db: DatabaseSync,
): LegacyBountyCompletionCarrier[] {
  return db
    .prepare(
      `SELECT c.*, d.title, o.kind AS offering_kind,
              o.definition_id AS offering_definition,
              o.interval_start, o.source_window AS offering_source_window
       FROM legacy_bounty_completion_carriers c
       JOIN bounty_definitions d ON d.id = c.definition_id
       JOIN bounty_offerings o ON o.id = c.offering_id
       ORDER BY c.source_window DESC, c.rowid DESC`,
    )
    .all()
    .map((row) => {
      if (!isRecord(row)) throw new Error("corrupt legacy Bounty carrier row");
      return carrierFromRow(db, row);
    });
}

function priorReceipt(
  db: DatabaseSync,
  command: LegacyBountyCompletionCorrectionCommand,
): LegacyBountyCorrectionReceipt | null {
  const row = db
    .prepare(
      `SELECT kind, payload, response FROM legacy_bounty_correction_receipts
       WHERE request_id = ?`,
    )
    .get(command.requestId);
  if (!row) return null;
  if (row.kind !== command.kind || row.payload !== JSON.stringify(command)) {
    throw new LegacyBountyCarrierStoreError(
      "That request identity has already been used for a different earlier Bounty correction.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(row.response));
  } catch {
    throw new Error("corrupt legacy Bounty correction receipt");
  }
  const receipt = parseLegacyBountyCorrectionReceipt(raw);
  if (!receipt) throw new Error("corrupt legacy Bounty correction receipt");
  return { ...receipt, status: "already-applied" };
}

function changeBalance(
  db: DatabaseSync,
  member: MemberId,
  delta: number,
): void {
  const current = Number(
    db.prepare("SELECT balance FROM star_balances WHERE member = ?").get(member)
      ?.balance ?? 0,
  );
  const next = current + delta;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new LegacyBountyCarrierStoreError(
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

function effectiveCredit(carrier: LegacyBountyCompletionCarrier): Readonly<{
  member: MemberId;
  stars: LegacyBountyCompletion["creditedStars"];
  provenance: BountyCreditProvenance;
}> {
  if (carrier.state.kind !== "completed")
    throw new Error("legacy Bounty carrier has no effective credit");
  const latest = carrier.state.correction
    ? carrier.history.find((row) => row.id === carrier.state.correction)
    : null;
  return {
    member: carrier.state.creditedTo,
    stars:
      latest?.creditedStars ?? carrier.state.effectiveCompletion.creditedStars,
    provenance:
      latest?.creditProvenance ??
      carrier.state.effectiveCompletion.creditProvenance,
  };
}

function insertCorrection(input: {
  db: DatabaseSync;
  id: BountyCorrectionId;
  command: LegacyBountyCompletionCorrectionCommand;
  kind: "undo" | "reassign";
  fromMember: MemberId;
  toMember: MemberId | null;
  stars: LegacyBountyCompletion["creditedStars"];
  provenance: BountyCreditProvenance;
}): void {
  input.db
    .prepare(
      `INSERT INTO bounty_completion_corrections
        (id, kind, subject_id, completion_id, predecessor_id, from_member,
         to_member, credited_stars, credit_provenance, reason, corrected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.kind,
      input.command.carrier,
      input.command.completion,
      input.command.predecessor,
      input.fromMember,
      input.toMember,
      input.stars,
      input.provenance,
      input.command.reason,
      nowInstant(),
    );
}

export function correctLegacyBountyCompletion(input: {
  db: DatabaseSync;
  command: LegacyBountyCompletionCorrectionCommand;
  members: readonly HouseholdMember[];
}): LegacyBountyCorrectionReceipt {
  const { db, command, members } = input;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = priorReceipt(db, command);
    if (replay) {
      db.exec("COMMIT");
      return replay;
    }
    const carrier = loadLegacyBountyCompletionCarriers(db).find(
      (row) => row.id === command.carrier,
    );
    if (
      !carrier ||
      carrier.revision !== command.revision ||
      carrier.state.correction !== command.predecessor ||
      carrier.state.kind !== "completed" ||
      carrier.state.effectiveCompletion.id !== command.completion
    ) {
      throw new LegacyBountyCarrierStoreError(
        "This earlier Bounty completion changed. Refresh before correcting it.",
      );
    }
    const credit = effectiveCredit(carrier);
    const correction = newBountyCorrectionId();
    let resultKind: LegacyBountyCorrectionReceipt["result"]["kind"];
    if (command.kind === "undo-legacy-bounty-completion") {
      changeBalance(db, credit.member, -credit.stars);
      insertCorrection({
        db,
        id: correction,
        command,
        kind: "undo",
        fromMember: credit.member,
        toMember: null,
        stars: credit.stars,
        provenance: credit.provenance,
      });
      db.prepare(
        `UPDATE legacy_bounty_completion_carriers
         SET state = 'released', revision = revision + 1,
             effective_completion_id = NULL, correction_id = ?
         WHERE id = ?`,
      ).run(correction, command.carrier);
      resultKind = "legacy-bounty-completion-undone";
    } else {
      const target = memberById([...members], command.member);
      if (!target) {
        throw new LegacyBountyCarrierStoreError(
          "This earlier Bounty completion can no longer be reassigned.",
        );
      }
      if (credit.member === target.id) {
        throw new LegacyBountyCarrierStoreError(
          "Choose a different member for this completion.",
        );
      }
      changeBalance(db, credit.member, -credit.stars);
      changeBalance(db, target.id, credit.stars);
      insertCorrection({
        db,
        id: correction,
        command,
        kind: "reassign",
        fromMember: credit.member,
        toMember: target.id,
        stars: credit.stars,
        provenance: credit.provenance,
      });
      db.prepare(
        `UPDATE legacy_bounty_completion_carriers
         SET revision = revision + 1, correction_id = ? WHERE id = ?`,
      ).run(correction, command.carrier);
      resultKind = "legacy-bounty-completion-reassigned";
    }
    const revision = parseLegacyBountyCarrierRevision(
      Number(command.revision) + 1,
    );
    if (revision === null)
      throw new Error("invalid corrected carrier revision");
    const receipt: LegacyBountyCorrectionReceipt = {
      status: "accepted",
      result: {
        kind: resultKind,
        carrier: command.carrier,
        revision,
      },
    };
    db.prepare(
      `INSERT INTO legacy_bounty_correction_receipts
        (request_id, kind, payload, response) VALUES (?, ?, ?, ?)`,
    ).run(
      command.requestId,
      command.kind,
      JSON.stringify(command),
      JSON.stringify(receipt),
    );
    db.exec("COMMIT");
    return receipt;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
