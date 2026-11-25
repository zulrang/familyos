import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  readHousehold,
  updateHousehold,
  writeHousehold,
} from "@/settings/settings";
import { closeTasksDatabase, loadDefinitions } from "@/tasks/store";
import { deruptHttp } from "./derupt";
import { FakeDerupt, type FakeHandOff } from "./derupt-fake.test-support";
import { receiveExternalTask } from "./intake-store";
import {
  type DeruptPollerDeps,
  MAX_BACKOFF_MS,
  nextPollDelay,
  POLL_INTERVAL_MS,
  pollDerupt,
  startExternalTaskSources,
} from "./poller";
import {
  resetExternalTaskSourcesForTests,
  setSourceStatus,
  sourceStatus,
  wakeExternalTaskSources,
} from "./source-status";
import { clearDeruptToken, saveDeruptToken } from "./token-store";

const TOKEN = "derupt_test_token_0123456789abcdef";
const NOW = new Date("2026-11-15T17:00:00Z");

let dir: string;
let derupt: FakeDerupt;
let logs: string[];

function deps(overrides: Partial<DeruptPollerDeps> = {}): DeruptPollerDeps {
  return {
    send: deruptHttp(derupt.url, TOKEN),
    receive: (request) => receiveExternalTask("derupt", request, NOW),
    now: () => NOW,
    log: (line) => logs.push(line),
    ...overrides,
  };
}

function task(id: string, extra: Partial<FakeHandOff> = {}): FakeHandOff {
  return { id, kind: "task", transcript: "Take out the recycling", ...extra };
}

const workId = (n: number) =>
  `00000000-0000-5000-8000-${String(n).padStart(12, "0")}`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "familyos-derupt-"));
  vi.stubEnv("FAMILYOS_DATA_DIR", dir);
  await writeHousehold({
    familyName: "Family",
    members: [
      { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
      { id: "ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
      { id: "gran", name: "Gran", status: "retired" },
    ],
    calendarId: null,
    calendarTimeZone: null,
    listIds: [],
    timeZone: "America/New_York",
    externalTaskDefaultMember: "dad",
    configVersion: 1,
  });
  derupt = new FakeDerupt(TOKEN);
  await derupt.listen();
  logs = [];
  resetExternalTaskSourcesForTests();
  setSourceStatus(
    "derupt",
    { state: "enabled", lastSuccessAt: null, lastProblem: null },
    "test",
  );
});

afterEach(async () => {
  expect(derupt.strictViolations).toEqual([]);
  await derupt.close();
  closeTasksDatabase();
  resetExternalTaskSourcesForTests();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("Derupt hand-offs become assigned Tasks", () => {
  test("creates the Task, acknowledges it, and records the poll", async () => {
    derupt.queue.push(
      task(workId(1), {
        transcript: "Feed  the cat",
        notes: "Two scoops",
        attributes: { Member: "ellie", stars: "2", time: "07:30" },
      }),
    );
    expect(await pollDerupt(deps())).toBe("drained");
    const definitions = loadDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      title: "Feed the cat — Two scoops",
      type: "chore",
      recurrence: { kind: "once", date: "2026-11-15" },
      assignment: { kind: "fixed", member: "ellie" },
      time: "07:30",
      stars: 2,
      retiredAt: null,
    });
    expect(derupt.outcomesFor(workId(1))).toEqual([
      { type: "acknowledged", generation: 1 },
    ]);
    expect(sourceStatus("derupt")).toEqual({
      state: "enabled",
      lastSuccessAt: NOW.toISOString(),
      lastProblem: null,
    });
    expect(logs.join("\n")).not.toMatch(/cat|scoops/);
  });

  test("claims repeatedly until no_work and fails kinds it does not take", async () => {
    derupt.queue.push(
      task(workId(1)),
      { id: workId(2), kind: "idea", transcript: "An idea" },
      task(workId(3), { transcript: "Sweep the porch" }),
    );
    expect(await pollDerupt(deps())).toBe("drained");
    expect(
      loadDefinitions()
        .map((row) => row.title)
        .sort(),
    ).toEqual(["Sweep the porch", "Take out the recycling"]);
    expect(derupt.outcomesFor(workId(2))).toEqual([
      {
        type: "failed",
        code: "kind_not_accepted",
        retryable: false,
        generation: 1,
      },
    ]);
    expect(derupt.received.filter((m) => m.type === "claim")).toHaveLength(4);
  });

  test("refuses an unknown member and a missing default without retry", async () => {
    derupt.queue.push(task(workId(1), { attributes: { member: "Grandpa" } }));
    derupt.queue.push(task(workId(2), { attributes: { member: "Gran" } }));
    await pollDerupt(deps());
    const result = await updateHousehold(1, {
      externalTaskDefaultMember: null,
    });
    expect(result.ok).toBe(true);
    derupt.queue.push(task(workId(3)));
    await pollDerupt(deps());
    expect(loadDefinitions()).toHaveLength(0);
    expect(
      [1, 2, 3].map((n) => derupt.outcomesFor(workId(n))[0]),
    ).toMatchObject([
      { type: "failed", code: "unknown_member", retryable: false },
      { type: "failed", code: "unknown_member", retryable: false },
      { type: "failed", code: "no_default_member", retryable: false },
    ]);
    expect(sourceStatus("derupt")).toMatchObject({
      lastProblem: { code: "no_default_member" },
    });
  });

  test("a redelivery does not duplicate the Task, even after settings change", async () => {
    derupt.queue.push(task(workId(1)));
    await pollDerupt(deps());
    await updateHousehold((await readHousehold()).configVersion, {
      externalTaskDefaultMember: "ellie",
    });
    derupt.queue.push(task(workId(1)));
    expect(await pollDerupt(deps())).toBe("drained");
    expect(loadDefinitions()).toHaveLength(1);
    expect(loadDefinitions()[0].assignment).toEqual({
      kind: "fixed",
      member: "dad",
    });
    expect(derupt.outcomesFor(workId(1))).toEqual([
      { type: "acknowledged", generation: 1 },
      { type: "acknowledged", generation: 2 },
    ]);
  });

  test("a lost acknowledgement backs off; the redelivery acknowledges the same Task", async () => {
    derupt.queue.push(task(workId(1)));
    derupt.queuedLeaseReplyOverrides.push(() => ({ status: 500 }));
    expect(await pollDerupt(deps())).toBe("backoff");
    expect(loadDefinitions()).toHaveLength(1);
    expect(sourceStatus("derupt")).toMatchObject({
      lastSuccessAt: null,
      lastProblem: { code: "server_error" },
    });
    derupt.queue.push(task(workId(1)));
    expect(await pollDerupt(deps())).toBe("drained");
    expect(loadDefinitions()).toHaveLength(1);
    expect(derupt.outcomesFor(workId(1))).toEqual([
      { type: "acknowledged", generation: 2 },
    ]);
  });

  test("a stale lease drops that attempt and keeps claiming", async () => {
    derupt.queue.push(task(workId(1)), task(workId(2)));
    derupt.queuedLeaseReplyOverrides.push(() => ({
      status: 200,
      body: {
        protocolVersion: "derupt.processing/2",
        type: "rejected",
        error: { code: "stale_lease", recoverable: true, message: "stale" },
      },
    }));
    expect(await pollDerupt(deps())).toBe("drained");
    expect(loadDefinitions()).toHaveLength(2);
    expect(derupt.outcomesFor(workId(1))).toEqual([]);
    expect(derupt.outcomesFor(workId(2))).toEqual([
      { type: "acknowledged", generation: 1 },
    ]);
    expect(sourceStatus("derupt")).toMatchObject({
      lastSuccessAt: NOW.toISOString(),
      lastProblem: { code: "stale_lease" },
    });
  });

  test("a stop is confirmed; a Task created earlier stays", async () => {
    derupt.queue.push(task(workId(1)));
    await pollDerupt(deps());
    derupt.queue.push(
      { id: workId(1), directive: "stop" },
      { id: workId(2), directive: "stop" },
    );
    expect(await pollDerupt(deps())).toBe("drained");
    expect(derupt.outcomesFor(workId(1)).at(-1)).toEqual({
      type: "canceled",
      generation: 2,
    });
    expect(derupt.outcomesFor(workId(2))).toEqual([
      { type: "canceled", generation: 1 },
    ]);
    expect(loadDefinitions()).toHaveLength(1);
  });

  test("an unavailable Task store fails the attempt as retryable and backs off", async () => {
    derupt.queue.push(task(workId(1)), task(workId(2)));
    const outcome = await pollDerupt(
      deps({
        receive: () => Promise.reject(new Error("disk full")),
      }),
    );
    expect(outcome).toBe("backoff");
    expect(derupt.outcomesFor(workId(1))).toEqual([
      {
        type: "failed",
        code: "intake_unavailable",
        retryable: true,
        generation: 1,
      },
    ]);
    expect(derupt.queue).toHaveLength(1);
  });
});

describe("source failures", () => {
  test("a 5xx backs off without losing work", async () => {
    derupt.queue.push(task(workId(1)));
    derupt.remainingServerErrorResponses = 1;
    expect(await pollDerupt(deps())).toBe("backoff");
    expect(sourceStatus("derupt")).toMatchObject({
      lastProblem: { code: "server_error" },
    });
    expect(await pollDerupt(deps())).toBe("drained");
    expect(loadDefinitions()).toHaveLength(1);
  });

  test("an unreachable source backs off", async () => {
    const url = derupt.url;
    const unreachable = deps({ send: deruptHttp(url, TOKEN) });
    await derupt.close();
    const outcome = await pollDerupt(unreachable);
    expect(outcome).toBe("backoff");
    expect(sourceStatus("derupt")).toMatchObject({
      lastProblem: { code: "network_error" },
    });
    await derupt.listen();
  });

  test("backoff doubles from the poll interval up to its limit", () => {
    expect(nextPollDelay("drained", 0)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay("backoff", 1)).toBe(2 * POLL_INTERVAL_MS);
    expect(nextPollDelay("backoff", 2)).toBe(4 * POLL_INTERVAL_MS);
    expect(nextPollDelay("backoff", 10)).toBe(MAX_BACKOFF_MS);
    expect(nextPollDelay("halted", 0)).toBeNull();
  });

  test("a rejected token (401) halts polling", async () => {
    derupt.queue.push(task(workId(1)));
    const outcome = await pollDerupt(
      deps({ send: deruptHttp(derupt.url, "wrong_token_0123456789") }),
    );
    expect(outcome).toBe("halted");
    expect(nextPollDelay(outcome, 0)).toBeNull();
    expect(sourceStatus("derupt")).toEqual({
      state: "halted",
      reason: "token_rejected",
      at: NOW.toISOString(),
      lastSuccessAt: null,
      lastProblem: null,
    });
    expect(logs).toHaveLength(1);
    expect(loadDefinitions()).toHaveLength(0);
  });

  test("a removed connection halts polling", async () => {
    derupt.revoked = true;
    expect(await pollDerupt(deps())).toBe("halted");
    expect(sourceStatus("derupt")).toMatchObject({
      state: "halted",
      reason: "connection_revoked",
    });
  });
});

describe("starting", () => {
  test("without a token the source is disabled and nothing polls", () => {
    resetExternalTaskSourcesForTests();
    startExternalTaskSources({});
    expect(sourceStatus("derupt")).toEqual({
      state: "disabled",
      reason: "not_configured",
    });
  });

  test("a malformed token disables the source", () => {
    resetExternalTaskSourcesForTests();
    startExternalTaskSources({ FAMILYOS_DERUPT_TOKEN: "short" });
    expect(sourceStatus("derupt")).toEqual({
      state: "disabled",
      reason: "invalid_token",
    });
  });

  test("a plain-HTTP endpoint off this machine is refused", () => {
    resetExternalTaskSourcesForTests();
    startExternalTaskSources({
      FAMILYOS_DERUPT_TOKEN: TOKEN,
      FAMILYOS_DERUPT_ENDPOINT: "http://derupt.example/processor",
    });
    expect(sourceStatus("derupt")).toEqual({
      state: "disabled",
      reason: "invalid_endpoint",
    });
  });

  test("only the first start in a process takes effect", () => {
    resetExternalTaskSourcesForTests();
    startExternalTaskSources({});
    startExternalTaskSources({
      FAMILYOS_DERUPT_TOKEN: TOKEN,
      FAMILYOS_DERUPT_ENDPOINT: derupt.url,
    });
    expect(sourceStatus("derupt")).toEqual({
      state: "disabled",
      reason: "not_configured",
    });
  });

  test("the production build does not start polling", () => {
    resetExternalTaskSourcesForTests();
    startExternalTaskSources({
      NEXT_PHASE: "phase-production-build",
      FAMILYOS_DERUPT_TOKEN: TOKEN,
    });
    expect(sourceStatus("derupt")).toBeNull();
  });

  test("a configured source polls on its own after startup", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      resetExternalTaskSourcesForTests();
      derupt.queue.push(task(workId(1)));
      startExternalTaskSources({
        FAMILYOS_DERUPT_TOKEN: TOKEN,
        FAMILYOS_DERUPT_ENDPOINT: derupt.url,
      });
      expect(sourceStatus("derupt")).toMatchObject({ state: "enabled" });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() =>
        expect(sourceStatus("derupt")).toMatchObject({
          lastSuccessAt: expect.any(String),
        }),
      );
      expect(loadDefinitions()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("changing the token without a restart", () => {
  const OTHER = "derupt_other_token_0123456789abcd";

  async function settle() {
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() =>
      expect(sourceStatus("derupt")).not.toMatchObject({
        state: "enabled",
        lastSuccessAt: null,
        lastProblem: null,
      }),
    );
  }

  test("a saved token starts polling, and clearing it stops", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      resetExternalTaskSourcesForTests();
      startExternalTaskSources({ FAMILYOS_DERUPT_ENDPOINT: derupt.url });
      expect(sourceStatus("derupt")).toEqual({
        state: "disabled",
        reason: "not_configured",
      });
      derupt.queue.push(task(workId(1)));
      await saveDeruptToken(TOKEN);
      wakeExternalTaskSources();
      await settle();
      expect(sourceStatus("derupt")).toMatchObject({
        state: "enabled",
        lastSuccessAt: expect.any(String),
      });
      expect(loadDefinitions()).toHaveLength(1);

      await clearDeruptToken();
      wakeExternalTaskSources();
      await vi.advanceTimersByTimeAsync(0);
      expect(sourceStatus("derupt")).toEqual({
        state: "disabled",
        reason: "not_configured",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("replacing a rejected token resumes a halted source", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      resetExternalTaskSourcesForTests();
      await saveDeruptToken(OTHER);
      startExternalTaskSources({ FAMILYOS_DERUPT_ENDPOINT: derupt.url });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() =>
        expect(sourceStatus("derupt")).toMatchObject({
          state: "halted",
          reason: "token_rejected",
        }),
      );
      await saveDeruptToken(TOKEN);
      wakeExternalTaskSources();
      await settle();
      expect(sourceStatus("derupt")).toMatchObject({
        state: "enabled",
        lastSuccessAt: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a saved token takes precedence over FAMILYOS_DERUPT_TOKEN", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      resetExternalTaskSourcesForTests();
      // Derupt accepts only TOKEN; the variable holds a different one.
      await saveDeruptToken(TOKEN);
      startExternalTaskSources({
        FAMILYOS_DERUPT_TOKEN: OTHER,
        FAMILYOS_DERUPT_ENDPOINT: derupt.url,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();
      expect(sourceStatus("derupt")).toMatchObject({
        state: "enabled",
        lastSuccessAt: expect.any(String),
      });

      // Clearing it falls back to the variable, which Derupt rejects.
      await clearDeruptToken();
      wakeExternalTaskSources();
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() =>
        expect(sourceStatus("derupt")).toMatchObject({
          state: "halted",
          reason: "token_rejected",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
