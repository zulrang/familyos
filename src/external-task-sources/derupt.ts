import { z } from "zod";
import type { ExternalTaskRequest } from "./intake";

/**
 * The Derupt adapter's protocol half: the messages FamilyOS sends, decoding of
 * Derupt's replies, and one HTTP exchange. Normative contract:
 * https://github.com/zulrang/derupt.app/blob/main/docs/processing-contract.md
 */
export const DERUPT_PROTOCOL_VERSION = "derupt.processing/2";
export const DERUPT_DEFAULT_ENDPOINT =
  "https://uakmjxuwtzzhudyzdngk.supabase.co/functions/v1/processor";

/** Returned with every message about one work item, exactly as received. */
export type DeruptLease = Readonly<
  { workId: string; generation: number } & Record<string, unknown>
>;

/** What FamilyOS sends. Derupt decodes strictly: only these fields. */
export type DeruptMessage =
  | Readonly<{ type: "claim"; capabilities: readonly ["hand_off"] }>
  | Readonly<{ type: "acknowledge"; lease: DeruptLease }>
  | Readonly<{ type: "confirm_cancellation"; lease: DeruptLease }>
  | Readonly<{
      type: "report_failure";
      lease: DeruptLease;
      code: string;
      retryable: boolean;
    }>;

export const CLAIM: DeruptMessage = {
  type: "claim",
  capabilities: ["hand_off"],
};

const leaseSchema = z.looseObject({
  workId: z.string().min(1),
  generation: z.number().int().min(1),
});

const workSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  action: z.string(),
  kind: z.string().optional(),
  directive: z.enum(["execute", "stop"]),
  submittedText: z
    .object({ transcript: z.string(), notes: z.string().optional() })
    .optional(),
  details: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  lease: leaseSchema,
});

const replySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("no_work") }),
  z.object({ type: z.literal("claimed"), work: z.unknown() }),
  z.object({
    type: z.literal("accepted"),
    directive: z.string().optional(),
  }),
  z.object({
    type: z.literal("rejected"),
    error: z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }),
  }),
]);

/**
 * A claimed work item. `unreadable` keeps only the lease when the rest does
 * not decode, so the item can still be failed instead of left to expire.
 */
export type DeruptWork =
  | Readonly<{
      kind: "execute";
      id: string;
      lease: DeruptLease;
      captureKind: string | null;
      request: ExternalTaskRequest | null;
    }>
  | Readonly<{ kind: "stop"; id: string; lease: DeruptLease }>
  | Readonly<{ kind: "unreadable"; lease: DeruptLease }>;

export type DeruptReply =
  | Readonly<{ type: "no_work" }>
  | Readonly<{ type: "claimed"; work: DeruptWork | null }>
  | Readonly<{ type: "accepted" }>
  | Readonly<{ type: "rejected"; code: string }>;

export function decodeWork(raw: unknown): DeruptWork | null {
  const parsed = workSchema.safeParse(raw);
  if (!parsed.success) {
    const lease =
      raw && typeof raw === "object" && "lease" in raw
        ? leaseSchema.safeParse(raw.lease)
        : null;
    return lease?.success ? { kind: "unreadable", lease: lease.data } : null;
  }
  const work = parsed.data;
  if (work.directive === "stop")
    return { kind: "stop", id: work.id, lease: work.lease };
  const text = work.submittedText;
  return {
    kind: "execute",
    id: work.id,
    lease: work.lease,
    captureKind: work.action === "hand_off" ? (work.kind ?? null) : null,
    request: text
      ? {
          id: work.id,
          transcript: text.transcript,
          notes: text.notes ?? null,
          details: work.details ?? null,
          attributes: Object.entries(work.attributes ?? {}),
        }
      : null,
  };
}

export function decodeReply(raw: unknown): DeruptReply | null {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return null;
  const reply = parsed.data;
  switch (reply.type) {
    case "no_work":
    case "accepted":
      return { type: reply.type };
    case "claimed":
      return { type: "claimed", work: decodeWork(reply.work) };
    case "rejected":
      return { type: "rejected", code: reply.error.code };
  }
}

export function encodeMessage(message: DeruptMessage): string {
  return JSON.stringify({
    protocolVersion: DERUPT_PROTOCOL_VERSION,
    ...message,
  });
}

/** One exchange. Transport problems are values; nothing here throws. */
export type DeruptExchange =
  | Readonly<{ kind: "reply"; reply: DeruptReply }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{
      kind: "unavailable";
      code: "network_error" | "server_error" | "unexpected_response";
    }>;

export type DeruptSend = (message: DeruptMessage) => Promise<DeruptExchange>;

export function deruptHttp(
  endpoint: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): DeruptSend {
  return async (message) => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: encodeMessage(message),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
    } catch {
      return { kind: "unavailable", code: "network_error" };
    }
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status >= 500)
      return { kind: "unavailable", code: "server_error" };
    if (response.status !== 200)
      return { kind: "unavailable", code: "unexpected_response" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unavailable", code: "network_error" };
    }
    const reply = decodeReply(body);
    return reply
      ? { kind: "reply", reply }
      : { kind: "unavailable", code: "unexpected_response" };
  };
}
