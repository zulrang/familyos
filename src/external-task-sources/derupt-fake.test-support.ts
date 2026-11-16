import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An in-memory Derupt processor endpoint for tests: a queue of hand-offs,
 * leases with generations, and strict decoding of what FamilyOS sends. Its
 * reply shapes follow the recorded examples pinned in derupt.contract.test.ts.
 */
export type FakeHandOff = {
  id: string;
  kind?: "idea" | "research" | "purchase" | "task";
  directive?: "execute" | "stop";
  transcript?: string;
  notes?: string;
  details?: string;
  attributes?: Record<string, string>;
};

export type FakeOutcome =
  | { type: "acknowledged"; generation: number }
  | { type: "failed"; code: string; retryable: boolean; generation: number }
  | { type: "canceled"; generation: number };

type Reply = { status: number; body?: unknown };

const ALLOWED_FIELDS: Record<string, string[]> = {
  claim: ["protocolVersion", "type", "capabilities"],
  acknowledge: ["protocolVersion", "type", "lease"],
  confirm_cancellation: ["protocolVersion", "type", "lease"],
  report_failure: ["protocolVersion", "type", "lease", "code", "retryable"],
};

export function claimedBody(work: FakeHandOff, generation: number) {
  const directive = work.directive ?? "execute";
  return {
    protocolVersion: "derupt.processing/2",
    type: "claimed",
    work: {
      id: work.id,
      action: "hand_off",
      kind: work.kind ?? "task",
      directive,
      source: {
        captureId: "8a288caf-3085-4949-8757-6f5f7f679082",
        revision: 1,
      },
      ...(directive === "execute"
        ? {
            submittedText: {
              transcript: work.transcript ?? "Take out the recycling",
              ...(work.notes ? { notes: work.notes } : {}),
            },
            ...(work.details ? { details: work.details } : {}),
            ...(work.attributes ? { attributes: work.attributes } : {}),
          }
        : {}),
      lease: { workId: work.id, generation },
      leaseExpiresAt: "2026-11-15T18:05:00Z",
      parameters: { leaseSeconds: 300, maxAttempts: 3 },
    },
  };
}

function rejected(code: string) {
  return {
    status: 200,
    body: {
      protocolVersion: "derupt.processing/2",
      type: "rejected",
      error: { code, recoverable: true, message: "rejected by fake" },
    },
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export class FakeDerupt {
  readonly queue: FakeHandOff[] = [];
  readonly outcomes = new Map<string, FakeOutcome[]>();
  readonly received: Record<string, unknown>[] = [];
  readonly strictViolations: string[] = [];
  /** Answer the next requests with HTTP 500. */
  serverErrors = 0;
  /** The connection was removed: claims are rejected not_authorized. */
  revoked = false;
  /** Per-message override, consumed in order, for lease messages. */
  readonly interceptions: ((
    message: Record<string, unknown>,
  ) => Reply | null)[] = [];
  private readonly generations = new Map<string, number>();
  private readonly leased = new Map<string, number>();
  private server: Server | null = null;

  constructor(readonly token: string) {}

  get url(): string {
    const address = this.server?.address() as AddressInfo | undefined;
    if (!address) throw new Error("fake Derupt is not listening");
    return `http://127.0.0.1:${address.port}/functions/v1/processor`;
  }

  async listen(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.respond(request).then(({ status, body }) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(body === undefined ? "" : JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) =>
      this.server?.listen(0, "127.0.0.1", resolve),
    );
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  outcomesFor(id: string): FakeOutcome[] {
    return this.outcomes.get(id) ?? [];
  }

  private record(id: string, outcome: FakeOutcome) {
    this.outcomes.set(id, [...this.outcomesFor(id), outcome]);
  }

  private async respond(request: IncomingMessage): Promise<Reply> {
    if (request.method !== "POST") return { status: 405 };
    if (request.headers.authorization !== `Bearer ${this.token}`)
      return { status: 401, body: { error: "unauthorized" } };
    const message = JSON.parse(await readBody(request)) as Record<
      string,
      unknown
    >;
    this.received.push(message);
    if (this.serverErrors > 0) {
      this.serverErrors -= 1;
      return { status: 500, body: { error: "internal_error" } };
    }
    const type = String(message.type);
    const allowed = ALLOWED_FIELDS[type];
    const extra = allowed
      ? Object.keys(message).filter((key) => !allowed.includes(key))
      : [type];
    const lease = message.lease as Record<string, unknown> | undefined;
    if (lease)
      extra.push(
        ...Object.keys(lease).filter(
          (key) => key !== "workId" && key !== "generation",
        ),
      );
    if (message.protocolVersion !== "derupt.processing/2")
      extra.push("protocolVersion");
    if (extra.length) {
      this.strictViolations.push(`${type}: ${extra.join(",")}`);
      return rejected("invalid_value");
    }
    if (type === "claim") return this.claim();
    const intercepted = this.interceptions.shift()?.(message) ?? null;
    if (intercepted) return intercepted;
    const workId = String(lease?.workId);
    const generation = Number(lease?.generation);
    if (this.leased.get(workId) !== generation) return rejected("stale_lease");
    this.leased.delete(workId);
    if (type === "acknowledge")
      this.record(workId, { type: "acknowledged", generation });
    else if (type === "confirm_cancellation")
      this.record(workId, { type: "canceled", generation });
    else
      this.record(workId, {
        type: "failed",
        code: String(message.code),
        retryable: message.retryable === true,
        generation,
      });
    return {
      status: 200,
      body: {
        protocolVersion: "derupt.processing/2",
        type: "accepted",
        workId,
        state: type === "confirm_cancellation" ? "canceled" : "completed",
      },
    };
  }

  private claim(): Reply {
    if (this.revoked) return rejected("not_authorized");
    const work = this.queue.shift();
    if (!work)
      return {
        status: 200,
        body: { protocolVersion: "derupt.processing/2", type: "no_work" },
      };
    const generation = (this.generations.get(work.id) ?? 0) + 1;
    this.generations.set(work.id, generation);
    this.leased.set(work.id, generation);
    return { status: 200, body: claimedBody(work, generation) };
  }
}
