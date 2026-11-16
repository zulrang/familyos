import { deruptConfig } from "./config";
import {
  CLAIM,
  type DeruptMessage,
  type DeruptSend,
  type DeruptWork,
  deruptHttp,
} from "./derupt";
import type { ExternalTaskRequest } from "./intake";
import { type IntakeOutcome, receiveExternalTask } from "./intake-store";
import {
  claimPollerStart,
  recordHalt,
  recordProblem,
  recordSuccess,
  setSourceStatus,
} from "./source-status";

const SOURCE = "derupt";
export const POLL_INTERVAL_MS = 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;
const FIRST_POLL_DELAY_MS = 5_000;
const BUSY_POLL_DELAY_MS = 1_000;
/** A guard against a source that never answers no_work. */
export const MAX_CLAIMS_PER_POLL = 100;

/**
 * drained: the queue reported no_work. busy: the claim limit was reached.
 * backoff: the source or the Task store is unavailable. halted: the token was
 * rejected or the connection removed; polling stops until restart.
 */
export type PollOutcome = "drained" | "busy" | "backoff" | "halted";

export type DeruptPollerDeps = Readonly<{
  send: DeruptSend;
  receive: (request: ExternalTaskRequest) => Promise<IntakeOutcome>;
  now: () => Date;
  log: (line: string) => void;
}>;

type Step = "continue" | "backoff" | "halted";

function halt(
  deps: DeruptPollerDeps,
  reason: "token_rejected" | "connection_revoked",
): "halted" {
  recordHalt(SOURCE, reason, deps.now());
  deps.log(
    reason === "token_rejected"
      ? "Derupt rejected the token (401). Polling stopped until FamilyOS restarts with a new FAMILYOS_DERUPT_TOKEN."
      : "The Derupt connection was removed. Polling stopped until FamilyOS restarts with a new FAMILYOS_DERUPT_TOKEN.",
  );
  return "halted";
}

function problem(deps: DeruptPollerDeps, code: string, work?: string) {
  recordProblem(SOURCE, code, deps.now());
  deps.log(`Derupt ${work ? `work ${work}` : "poll"}: ${code}`);
}

/** Send a message that ends this attempt; a refused one just ends it. */
async function finish(
  deps: DeruptPollerDeps,
  work: string,
  message: DeruptMessage,
): Promise<Step> {
  const exchange = await deps.send(message);
  if (exchange.kind === "unauthorized") return halt(deps, "token_rejected");
  if (exchange.kind === "unavailable") {
    problem(deps, exchange.code, work);
    return "backoff";
  }
  // stale_lease, lease_expired and illegal_transition mean this attempt is
  // over; Derupt hands the work out again if it still needs doing.
  if (exchange.reply.type === "rejected")
    problem(deps, exchange.reply.code, work);
  return "continue";
}

function fail(
  deps: DeruptPollerDeps,
  work: string,
  lease: DeruptWork["lease"],
  code: string,
  retryable: boolean,
) {
  return finish(deps, work, { type: "report_failure", lease, code, retryable });
}

async function handle(
  deps: DeruptPollerDeps,
  work: DeruptWork | null,
): Promise<Step> {
  if (!work) {
    // Without a lease there is nothing to answer; the lease lapses.
    problem(deps, "unreadable_work");
    return "continue";
  }
  if (work.kind === "unreadable") {
    problem(deps, "invalid_hand_off", work.lease.workId);
    return fail(deps, work.lease.workId, work.lease, "invalid_hand_off", false);
  }
  if (work.kind === "stop") {
    // A Task already created stays: parents can retire it in admin.
    return finish(deps, work.id, {
      type: "confirm_cancellation",
      lease: work.lease,
    });
  }
  if (work.captureKind !== "task") {
    problem(deps, "kind_not_accepted", work.id);
    return fail(deps, work.id, work.lease, "kind_not_accepted", false);
  }
  if (!work.request) {
    problem(deps, "invalid_hand_off", work.id);
    return fail(deps, work.id, work.lease, "invalid_hand_off", false);
  }
  let outcome: IntakeOutcome;
  try {
    outcome = await deps.receive(work.request);
  } catch (error) {
    console.error("External task intake failed", error);
    problem(deps, "intake_unavailable", work.id);
    const step = await fail(
      deps,
      work.id,
      work.lease,
      "intake_unavailable",
      true,
    );
    return step === "halted" ? step : "backoff";
  }
  if (outcome.kind === "refused") {
    problem(deps, outcome.refusal, work.id);
    return fail(deps, work.id, work.lease, outcome.refusal, false);
  }
  return finish(deps, work.id, { type: "acknowledge", lease: work.lease });
}

/** Claim and handle work until Derupt reports no_work, or a stop condition. */
export async function pollDerupt(deps: DeruptPollerDeps): Promise<PollOutcome> {
  for (let claims = 0; claims < MAX_CLAIMS_PER_POLL; claims++) {
    const exchange = await deps.send(CLAIM);
    if (exchange.kind === "unauthorized") return halt(deps, "token_rejected");
    if (exchange.kind === "unavailable") {
      problem(deps, exchange.code);
      return "backoff";
    }
    const reply = exchange.reply;
    if (reply.type === "no_work") {
      recordSuccess(SOURCE, deps.now());
      return "drained";
    }
    if (reply.type === "rejected") {
      if (reply.code === "not_authorized")
        return halt(deps, "connection_revoked");
      problem(deps, reply.code);
      return "backoff";
    }
    if (reply.type !== "claimed") {
      problem(deps, "unexpected_response");
      return "backoff";
    }
    const step = await handle(deps, reply.work);
    if (step !== "continue") return step;
  }
  return "busy";
}

/** Delay before the next poll; null stops polling. */
export function nextPollDelay(
  outcome: PollOutcome,
  consecutiveFailures: number,
): number | null {
  switch (outcome) {
    case "halted":
      return null;
    case "busy":
      return BUSY_POLL_DELAY_MS;
    case "drained":
      return POLL_INTERVAL_MS;
    case "backoff":
      return Math.min(
        POLL_INTERVAL_MS * 2 ** Math.max(consecutiveFailures, 1),
        MAX_BACKOFF_MS,
      );
  }
}

function log(line: string) {
  console.info(`[external-task-sources] ${line}`);
}

/**
 * Start polling every configured External Task Source, once per process. It
 * never throws and never blocks startup: the first poll runs after a delay.
 */
export function startExternalTaskSources(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  try {
    if (env.NEXT_PHASE === "phase-production-build") return;
    if (!claimPollerStart()) return;
    const config = deruptConfig(env);
    if (config.state === "disabled") {
      setSourceStatus(SOURCE, config);
      if (config.reason !== "not_configured")
        log(`Derupt disabled: ${config.reason}`);
      return;
    }
    setSourceStatus(SOURCE, {
      state: "enabled",
      lastSuccessAt: null,
      lastProblem: null,
    });
    const deps: DeruptPollerDeps = {
      send: deruptHttp(config.endpoint, config.token),
      receive: (request) => receiveExternalTask(SOURCE, request, new Date()),
      now: () => new Date(),
      log,
    };
    let failures = 0;
    const schedule = (delay: number) => {
      setTimeout(() => void run(), delay).unref();
    };
    const run = async () => {
      let outcome: PollOutcome;
      try {
        outcome = await pollDerupt(deps);
      } catch (error) {
        console.error("External task polling failed", error);
        recordProblem(SOURCE, "internal_error", new Date());
        outcome = "backoff";
      }
      failures = outcome === "backoff" ? failures + 1 : 0;
      const delay = nextPollDelay(outcome, failures);
      if (delay !== null) schedule(delay);
    };
    schedule(FIRST_POLL_DELAY_MS);
    log("Derupt polling enabled");
  } catch (error) {
    console.error("External task sources did not start", error);
  }
}
