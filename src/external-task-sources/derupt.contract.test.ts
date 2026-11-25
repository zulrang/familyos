import { describe, expect, test } from "vitest";
import { CLAIM, type DeruptLease, decodeReply, encodeMessage } from "./derupt";
import { claimedBody } from "./derupt-fake.test-support";

const recordedClaimed = {
  protocolVersion: "derupt.processing/2",
  type: "claimed",
  work: {
    id: "8122da57-6b67-5804-8ef8-1c587f6aeb7f",
    action: "hand_off",
    kind: "idea",
    directive: "execute",
    source: { captureId: "8a288caf-3085-4949-8757-6f5f7f679082", revision: 1 },
    submittedText: { transcript: "Testing the capture idea." },
    details: "For the reading nook.\nWarm light, not too bright.",
    attributes: { priority: "low", project: "House" },
    lease: { workId: "8122da57-6b67-5804-8ef8-1c587f6aeb7f", generation: 1 },
    leaseExpiresAt: "2026-11-12T02:14:42Z",
    parameters: { leaseSeconds: 300, maxAttempts: 3 },
  },
};

const recordedRejected = {
  protocolVersion: "derupt.processing/2",
  type: "rejected",
  error: {
    code: "invalid_value",
    recoverable: true,
    message: "lease.generation is invalid (out_of_range).",
    field: "lease.generation",
    reason: "out_of_range",
  },
};

const lease: DeruptLease = {
  workId: "8122da57-6b67-5804-8ef8-1c587f6aeb7f",
  generation: 1,
};

describe("recorded Derupt replies decode", () => {
  test("claimed hand-off", () => {
    expect(decodeReply(recordedClaimed)).toEqual({
      type: "claimed",
      work: {
        kind: "execute",
        id: "8122da57-6b67-5804-8ef8-1c587f6aeb7f",
        lease,
        captureKind: "idea",
        request: {
          id: "8122da57-6b67-5804-8ef8-1c587f6aeb7f",
          transcript: "Testing the capture idea.",
          notes: null,
          details: "For the reading nook.\nWarm light, not too bright.",
          attributes: [
            ["priority", "low"],
            ["project", "House"],
          ],
        },
      },
    });
  });

  test("a stop carries no text", () => {
    const {
      submittedText: _t,
      details: _d,
      attributes: _a,
      ...work
    } = recordedClaimed.work;
    expect(
      decodeReply({
        ...recordedClaimed,
        work: { ...work, kind: "task", directive: "stop" },
      }),
    ).toEqual({
      type: "claimed",
      work: { kind: "stop", id: work.id, lease },
    });
  });

  test("no_work, accepted and rejected", () => {
    expect(
      decodeReply({ protocolVersion: "derupt.processing/2", type: "no_work" }),
    ).toEqual({ type: "no_work" });
    expect(
      decodeReply({
        protocolVersion: "derupt.processing/2",
        type: "accepted",
        workId: lease.workId,
        state: "completed",
      }),
    ).toEqual({ type: "accepted" });
    expect(decodeReply(recordedRejected)).toEqual({
      type: "rejected",
      code: "invalid_value",
    });
  });

  test("unknown server fields are ignored, and the lease returns unchanged", () => {
    const reply = decodeReply({
      ...recordedClaimed,
      work: {
        ...recordedClaimed.work,
        resumption: { priorExecution: "x" },
        lease: { ...lease, future: 1 },
      },
    });
    expect(reply).toMatchObject({
      type: "claimed",
      work: { lease: { ...lease, future: 1 } },
    });
  });

  test("a work item that does not decode keeps its lease so it can be failed", () => {
    expect(
      decodeReply({
        ...recordedClaimed,
        work: { ...recordedClaimed.work, directive: "later" },
      }),
    ).toEqual({ type: "claimed", work: { kind: "unreadable", lease } });
  });
});

describe("FamilyOS messages match the recorded requests", () => {
  test("claim", () => {
    expect(JSON.parse(encodeMessage(CLAIM))).toEqual({
      protocolVersion: "derupt.processing/2",
      type: "claim",
      capabilities: ["hand_off"],
    });
  });

  test("acknowledge, report_failure and confirm_cancellation", () => {
    expect(JSON.parse(encodeMessage({ type: "acknowledge", lease }))).toEqual({
      protocolVersion: "derupt.processing/2",
      type: "acknowledge",
      lease,
    });
    expect(
      Object.keys(
        JSON.parse(
          encodeMessage({
            type: "report_failure",
            lease,
            code: "kind_not_accepted",
            retryable: false,
          }),
        ),
      ).sort(),
    ).toEqual(["code", "lease", "protocolVersion", "retryable", "type"]);
    expect(
      Object.keys(
        JSON.parse(encodeMessage({ type: "confirm_cancellation", lease })),
      ).sort(),
    ).toEqual(["lease", "protocolVersion", "type"]);
  });
});

test("the test Fake's claims have the recorded shape", () => {
  const fake = claimedBody(
    {
      id: recordedClaimed.work.id,
      kind: "idea",
      transcript: "Testing the capture idea.",
      details: recordedClaimed.work.details,
      attributes: recordedClaimed.work.attributes,
    },
    1,
  );
  expect(Object.keys(fake.work).sort()).toEqual(
    Object.keys(recordedClaimed.work).sort(),
  );
  expect(decodeReply(fake)).toEqual(decodeReply(recordedClaimed));
});
