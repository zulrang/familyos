import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as saveMember } from "@/app/admin/api/members/route";
import { handleAdminMembers } from "@/members/admin-http";
import { readHousehold, writeHousehold } from "@/settings/settings";
import { handleAdminSession } from "@/shared/admin-auth";
import { handleAdminTasks } from "./admin-http";
import { correctAdminCompletion, createAdminTask } from "./admin-store";
import { parseTaskAdminCommand, type TaskAdminRead } from "./admin-types";
import {
  claimBounty,
  completeBounty,
  createBounty,
  loadAvailableBounties,
  loadBountyClaims,
  loadBountyDefinitions,
  releaseBounty,
  replaceDefinition,
} from "./bounty-store";
import {
  applyEvent,
  closeTasksDatabase,
  loadDefinitions,
  loadEvents,
  loadStoredStarBalances,
  tasksDatabase,
} from "./store";
import {
  type CreateTaskDraft,
  type LegacyTaskDefinition,
  nowInstant,
  parseBountyCommand,
  parseLocalDate,
  parseTaskCreateDraft,
} from "./types";
import { view } from "./view";

describe("parent administration", () => {
  let dir: string;
  let cookie: string;
  const today = (() => {
    const date = parseLocalDate("2026-09-08");
    if (!date) throw new Error("Invalid test date");
    return date;
  })();
  const draft: CreateTaskDraft = {
    title: "Dishes",
    type: "chore",
    recurrence: { kind: "daily" },
    assignment: { kind: "fixed", member: "a" },
    time: null,
    stars: 5,
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "familyos-admin-http-"));
    vi.stubEnv("FAMILYOS_DATA_DIR", dir);
    vi.stubEnv("FAMILYOS_ADMIN_PIN", "123456");
    await writeHousehold({
      familyName: "Family",
      members: [
        { id: "a", name: "Alex", status: "active", color: "#a9d8d2" },
        { id: "b", name: "Bailey", status: "active", color: "#dccfea" },
        { id: "c", name: "Casey", status: "active", color: "#f6c9c5" },
      ],
      calendarId: null,
      calendarTimeZone: null,
      listIds: [],
      timeZone: "America/New_York",
      configVersion: 1,
    });
    cookie = "";
    const login = await handleAdminSession(
      request("session", { pin: "123456" }),
    );
    cookie = login.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  function request(endpoint: string, body?: unknown) {
    return new Request(`http://familyos.test/admin/api/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: "http://familyos.test",
        "x-familyos-admin": "1",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const tasks = (body?: unknown) => handleAdminTasks(request("tasks", body));
  async function snapshot(): Promise<TaskAdminRead> {
    return (await tasks()).json();
  }
  async function create(overrides: Partial<CreateTaskDraft> = {}) {
    const result = await tasks({
      kind: "create",
      id: crypto.randomUUID(),
      draft: { ...draft, ...overrides },
    });
    expect(result.status).toBe(200);
    return ((await result.json()) as { definition: LegacyTaskDefinition })
      .definition;
  }
  function complete(task: LegacyTaskDefinition, member = "a") {
    return applyEvent({
      kind: "completed",
      task: task.id,
      window: today,
      by: member,
      at: nowInstant(),
    });
  }
  function balance(member: string) {
    return (
      loadStoredStarBalances().find((row) => row.member === member)?.balance ??
      0
    );
  }

  async function completedBounty(
    overrides: {
      title?: string;
      stars?: number;
      member?: string;
      recurrence?: unknown;
    } = {},
  ) {
    const draft = parseTaskCreateDraft({
      kind: "bounty",
      title: overrides.title ?? "Wash car",
      stars: overrides.stars ?? 4,
      recurrence: overrides.recurrence ?? { kind: "once" },
    });
    if (!draft || draft.kind !== "bounty")
      throw new Error("Invalid Bounty fixture");
    const definition = createBounty(tasksDatabase(), draft, today);
    const offering = loadAvailableBounties(tasksDatabase(), today).find(
      (row) => row.offering.definition === definition.id,
    );
    if (!offering) throw new Error("Missing Bounty offering fixture");
    const claim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: offering.offering,
      member: overrides.member ?? "a",
      definitionRevision: offering.definitionRevision,
    });
    if (!claim || claim.kind !== "claim-bounty")
      throw new Error("Invalid Bounty Claim fixture");
    const claimed = claimBounty({
      db: tasksDatabase(),
      command: claim,
      today,
      members: (await readHousehold()).members,
    });
    if (!("result" in claimed) || claimed.result.kind !== "claimed")
      throw new Error("Bounty was not claimed");
    const completion = parseBountyCommand({
      kind: "complete-bounty",
      requestId: crypto.randomUUID(),
      claim: claimed.result.claim.id,
      revision: claimed.result.revision,
    });
    if (!completion || completion.kind !== "complete-bounty")
      throw new Error("Invalid Bounty Completion fixture");
    const completed = completeBounty({
      db: tasksDatabase(),
      command: completion,
    });
    if (!("result" in completed) || completed.result.kind !== "completed")
      throw new Error("Bounty was not completed");
    return {
      definition,
      claim: claimed.result.claim,
      completion: completed.result.completion,
    };
  }

  test("paired-display credentials cannot bypass the PIN on reads or writes", async () => {
    cookie = "familyos_display=not-an-admin-session";
    expect((await tasks()).status).toBe(401);
    expect(
      (await tasks({ kind: "create", id: crypto.randomUUID(), draft })).status,
    ).toBe(401);
    expect(
      (
        await tasks({
          kind: "edit-bounty",
          requestId: crypto.randomUUID(),
          definition: crypto.randomUUID(),
          revision: 0,
          draft: { title: "No access", stars: 1 },
        })
      ).status,
    ).toBe(401);
    expect((await handleAdminMembers(request("members"))).status).toBe(401);
    expect(loadDefinitions()).toHaveLength(0);
  });
  test("Bounty edits are revision-guarded, retry-safe, and change only future claims", async () => {
    const members = (await readHousehold()).members;
    const bountyDraft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Wash car",
      stars: 4,
      recurrence: { kind: "once" },
    });
    expect(bountyDraft?.kind).toBe("bounty");
    if (!bountyDraft || bountyDraft.kind !== "bounty") return;
    const definition = createBounty(tasksDatabase(), bountyDraft, today);
    const staleOffering = loadAvailableBounties(tasksDatabase(), today)[0];
    expect(staleOffering?.definitionRevision).toBe(0);

    const edit = {
      kind: "edit-bounty",
      requestId: crypto.randomUUID(),
      definition: definition.id,
      revision: 0,
      draft: { title: "Polish car", stars: 7 },
    };
    const edited = await tasks(edit);
    expect(edited.status).toBe(200);
    expect((await edited.json()).receipt).toMatchObject({
      status: "accepted",
      definition: { title: "Polish car", stars: 7, revision: 1 },
    });
    expect((await tasks(edit)).status).toBe(200);
    expect(
      (await tasks({ ...edit, draft: { ...edit.draft, stars: 8 } })).status,
    ).toBe(409);

    const staleClaim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: staleOffering?.offering,
      member: "a",
      definitionRevision: staleOffering?.definitionRevision,
    });
    expect(staleClaim?.kind).toBe("claim-bounty");
    if (!staleClaim || staleClaim.kind !== "claim-bounty") return;
    expect(() =>
      claimBounty({
        db: tasksDatabase(),
        command: staleClaim,
        today,
        members,
      }),
    ).toThrow("no longer available");

    const currentOffering = loadAvailableBounties(tasksDatabase(), today)[0];
    const currentClaim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: currentOffering?.offering,
      member: "a",
      definitionRevision: currentOffering?.definitionRevision,
    });
    expect(currentClaim?.kind).toBe("claim-bounty");
    if (!currentClaim || currentClaim.kind !== "claim-bounty") return;
    const claimed = claimBounty({
      db: tasksDatabase(),
      command: currentClaim,
      today,
      members,
    });
    if (!("result" in claimed)) return;
    expect(claimed.result).toMatchObject({
      kind: "claimed",
      claim: { title: "Polish car", stars: 7 },
    });

    const nextEdit = {
      ...edit,
      requestId: crypto.randomUUID(),
      revision: 1,
      draft: { title: "Polish and vacuum car", stars: 9 },
    };
    expect((await tasks(nextEdit)).status).toBe(200);
    expect((await (await tasks(edit)).json()).receipt).toMatchObject({
      status: "already-applied",
      definition: { title: "Polish car", stars: 7, revision: 1 },
    });
    expect(loadBountyClaims(tasksDatabase())[0]?.claim).toMatchObject({
      title: "Polish car",
      stars: 7,
    });
  });
  test("definition replacement preserves lineage and accepts only legal conversions", async () => {
    const serverToday = (await snapshot()).today;
    const bountyDraft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Wash car",
      stars: 4,
      recurrence: { kind: "once" },
    });
    expect(bountyDraft?.kind).toBe("bounty");
    if (!bountyDraft || bountyDraft.kind !== "bounty") return;
    const bounty = createBounty(tasksDatabase(), bountyDraft, serverToday);
    const available = loadAvailableBounties(tasksDatabase(), serverToday)[0];
    const claimCommand = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: available?.offering,
      member: "a",
      definitionRevision: available?.definitionRevision,
    });
    expect(claimCommand?.kind).toBe("claim-bounty");
    if (!claimCommand || claimCommand.kind !== "claim-bounty") return;
    const acceptedClaim = claimBounty({
      db: tasksDatabase(),
      command: claimCommand,
      today: serverToday,
      members: (await readHousehold()).members,
    });
    if (
      !("result" in acceptedClaim) ||
      acceptedClaim.result.kind !== "claimed"
    ) {
      return;
    }
    const requestId = crypto.randomUUID();
    const convertToAssigned = {
      kind: "replace-definition",
      requestId,
      source: {
        kind: "bounty",
        definition: bounty.id,
        revision: bounty.revision,
      },
      replacement: {
        kind: "assigned",
        title: "Wash car",
        type: "chore",
        recurrence: { kind: "weekly", days: ["sun"] },
        assignment: { kind: "fixed", member: "a" },
        time: "10:00",
        stars: 4,
      },
    };
    const converted = await tasks(convertToAssigned);
    expect(converted.status).toBe(200);
    const receipt = (await converted.json()).receipt;
    expect(receipt).toMatchObject({
      status: "accepted",
      replacement: { kind: "assigned", lineage: bounty.lineage },
    });
    expect((await tasks(convertToAssigned)).status).toBe(200);
    expect(
      (
        await tasks({
          ...convertToAssigned,
          replacement: { ...convertToAssigned.replacement, stars: 5 },
        })
      ).status,
    ).toBe(409);
    const assigned = loadDefinitions().find(
      (definition) => definition.id === receipt.replacement.id,
    );
    expect(assigned).toMatchObject({
      lineage: bounty.lineage,
      retiredAt: null,
      assignment: { kind: "fixed", member: "a" },
    });
    expect(
      loadBountyDefinitions(tasksDatabase()).find(
        (definition) => definition.id === bounty.id,
      ),
    ).toMatchObject({ retiredAt: serverToday });
    const completion = parseBountyCommand({
      kind: "complete-bounty",
      requestId: crypto.randomUUID(),
      claim: acceptedClaim.result.claim.id,
      revision: acceptedClaim.result.revision,
    });
    expect(completion?.kind).toBe("complete-bounty");
    if (!completion || completion.kind !== "complete-bounty") return;
    expect(
      completeBounty({ db: tasksDatabase(), command: completion }),
    ).toMatchObject({
      status: "accepted",
      result: { kind: "completed", completion: { creditedStars: 4 } },
    });

    const back = await tasks({
      kind: "replace-definition",
      requestId: crypto.randomUUID(),
      source: { kind: "assigned", definition: assigned?.id },
      replacement: {
        kind: "bounty",
        title: "Wash car",
        stars: 6,
        recurrence: { kind: "once" },
      },
    });
    expect(back.status).toBe(200);
    expect((await back.json()).receipt).toMatchObject({
      status: "accepted",
      replacement: { kind: "bounty", lineage: bounty.lineage },
    });

    for (const replacement of [
      { ...convertToAssigned.replacement, kind: "typo" },
      {
        ...convertToAssigned.replacement,
        assignment: { kind: "open" },
      },
      {
        kind: "bounty",
        title: "Mixed",
        stars: 1,
        recurrence: { kind: "once" },
        assignment: { kind: "fixed", member: "a" },
      },
    ]) {
      expect(
        (
          await tasks({
            ...convertToAssigned,
            requestId: crypto.randomUUID(),
            replacement,
          })
        ).status,
      ).toBe(400);
    }
  });

  test("new open Routines are rejected at the administration boundary", async () => {
    expect(
      (
        await tasks({
          kind: "create",
          id: crypto.randomUUID(),
          draft: {
            ...draft,
            type: "routine",
            assignment: { kind: "open" },
          },
        })
      ).status,
    ).toBe(400);
  });

  test("legacy open Routines allow metadata edits without allowing a new schedule", async () => {
    await snapshot();
    const legacy = createAdminTask(crypto.randomUUID(), {
      ...draft,
      title: "Morning check",
      type: "routine",
      recurrence: { kind: "weekly", days: ["mon", "fri"] },
      assignment: { kind: "open" },
    });
    const metadataEdit = {
      kind: "edit",
      task: legacy.id,
      draft: {
        ...draft,
        title: "Morning checklist",
        type: "routine",
        recurrence: { kind: "weekly", days: ["fri", "mon"] },
        assignment: { kind: "open" },
        time: "08:00",
        stars: 1,
      },
    };
    expect((await tasks(metadataEdit)).status).toBe(200);
    expect(loadDefinitions().find((row) => row.id === legacy.id)).toMatchObject(
      {
        title: "Morning checklist",
        type: "routine",
        assignment: { kind: "open" },
        recurrence: { kind: "weekly", days: ["mon", "fri"] },
        time: "08:00",
        stars: 1,
      },
    );
    expect(
      (
        await tasks({
          ...metadataEdit,
          draft: {
            ...metadataEdit.draft,
            recurrence: { kind: "weekly", days: ["tue"] },
          },
        })
      ).status,
    ).toBe(409);
  });

  test("an accepted conversion replays after its assigned member retires", async () => {
    const serverToday = (await snapshot()).today;
    const draft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Porch",
      stars: 2,
      recurrence: { kind: "once" },
    });
    expect(draft?.kind).toBe("bounty");
    if (!draft || draft.kind !== "bounty") return;
    const source = createBounty(tasksDatabase(), draft, serverToday);
    const command = {
      kind: "replace-definition",
      requestId: crypto.randomUUID(),
      source: {
        kind: "bounty",
        definition: source.id,
        revision: source.revision,
      },
      replacement: {
        kind: "assigned",
        title: "Porch",
        type: "chore",
        recurrence: { kind: "daily" },
        assignment: { kind: "fixed", member: "a" },
        time: null,
        stars: 2,
      },
    };
    expect((await tasks(command)).status).toBe(200);
    const household = await readHousehold();
    await writeHousehold({
      ...household,
      members: household.members.map((member) =>
        member.id === "a"
          ? { id: member.id, name: member.name, status: "retired" as const }
          : member,
      ),
      configVersion: household.configVersion + 1,
    });
    const replay = await tasks(command);
    expect(replay.status).toBe(200);
    expect((await replay.json()).receipt.status).toBe("already-applied");
  });

  test("schedule replacement waits for the next matching interval and preserves old claims", async () => {
    const members = (await readHousehold()).members;
    const sourceDraft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Bins",
      stars: 3,
      recurrence: {
        kind: "recurring",
        startsOn: "2026-09-01",
        cadence: { kind: "weekly", days: ["mon"] },
      },
    });
    expect(sourceDraft?.kind).toBe("bounty");
    if (!sourceDraft || sourceDraft.kind !== "bounty") return;
    const source = createBounty(tasksDatabase(), sourceDraft, today);
    const offered = loadAvailableBounties(tasksDatabase(), today)[0];
    const claim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: offered?.offering,
      member: "a",
      definitionRevision: offered?.definitionRevision,
    });
    expect(claim?.kind).toBe("claim-bounty");
    if (!claim || claim.kind !== "claim-bounty") return;
    const claimReceipt = claimBounty({
      db: tasksDatabase(),
      command: claim,
      today,
      members,
    });
    if (!("result" in claimReceipt) || claimReceipt.result.kind !== "claimed")
      return;

    const replacementCommand = parseTaskAdminCommand({
      kind: "replace-definition",
      requestId: crypto.randomUUID(),
      source: {
        kind: "bounty",
        definition: source.id,
        revision: source.revision,
      },
      replacement: {
        kind: "bounty",
        title: "Bins",
        stars: 3,
        recurrence: {
          kind: "recurring",
          startsOn: "2026-09-01",
          cadence: { kind: "weekly", days: ["mon", "fri"] },
        },
      },
    });
    expect(replacementCommand?.kind).toBe("replace-definition");
    if (!replacementCommand || replacementCommand.kind !== "replace-definition")
      return;
    const replacement = replaceDefinition({
      db: tasksDatabase(),
      command: replacementCommand,
      today,
      members,
    });
    expect(replacement.replacement.id).not.toBe(source.id);
    expect(replacement.replacement.lineage).toBe(source.lineage);
    expect(loadAvailableBounties(tasksDatabase(), today)).toHaveLength(0);
    const beforeFriday = parseLocalDate("2026-09-10");
    const friday = parseLocalDate("2026-09-11");
    expect(beforeFriday).not.toBeNull();
    expect(friday).not.toBeNull();
    if (!beforeFriday || !friday) return;
    expect(loadAvailableBounties(tasksDatabase(), beforeFriday)).toHaveLength(
      0,
    );
    expect(loadAvailableBounties(tasksDatabase(), friday)).toContainEqual(
      expect.objectContaining({
        offering: expect.objectContaining({
          definition: replacement.replacement.id,
          intervalStart: friday,
        }),
      }),
    );

    const release = parseBountyCommand({
      kind: "release-bounty",
      requestId: crypto.randomUUID(),
      claim: claimReceipt.result.claim.id,
      revision: claimReceipt.result.revision,
    });
    expect(release?.kind).toBe("release-bounty");
    if (!release || release.kind !== "release-bounty") return;
    releaseBounty({ db: tasksDatabase(), command: release });
    expect(
      loadAvailableBounties(tasksDatabase(), today).some(
        (item) => item.offering.definition === source.id,
      ),
    ).toBe(false);
  });

  test("semantically unchanged recurrence edits keep definition and offering identity", () => {
    const sourceDraft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Plants",
      stars: 2,
      recurrence: {
        kind: "recurring",
        startsOn: "2026-09-01",
        cadence: { kind: "weekly", days: ["mon", "fri"] },
      },
    });
    expect(sourceDraft?.kind).toBe("bounty");
    if (!sourceDraft || sourceDraft.kind !== "bounty") return;
    const source = createBounty(tasksDatabase(), sourceDraft, today);
    const offering = loadAvailableBounties(tasksDatabase(), today)[0];
    const command = parseTaskAdminCommand({
      kind: "replace-definition",
      requestId: crypto.randomUUID(),
      source: {
        kind: "bounty",
        definition: source.id,
        revision: source.revision,
      },
      replacement: {
        kind: "bounty",
        title: "Healthy plants",
        stars: 5,
        recurrence: {
          kind: "recurring",
          startsOn: "2026-09-01",
          cadence: { kind: "weekly", days: ["fri", "mon"] },
        },
      },
    });
    expect(command?.kind).toBe("replace-definition");
    if (!command || command.kind !== "replace-definition") return;
    expect(
      replaceDefinition({ db: tasksDatabase(), command, today, members: [] }),
    ).toMatchObject({
      status: "accepted",
      replacement: { id: source.id },
    });
    expect(loadBountyDefinitions(tasksDatabase())).toHaveLength(1);
    expect(loadBountyDefinitions(tasksDatabase())[0]).toMatchObject({
      id: source.id,
      title: "Healthy plants",
      stars: 5,
      revision: 1,
      retiredAt: null,
    });
    expect(loadAvailableBounties(tasksDatabase(), today)[0]).toMatchObject({
      id: offering?.id,
      offering: { definition: source.id },
    });
  });
  test("retiring a Bounty preserves claims while stopping every reopened offering", async () => {
    const members = (await readHousehold()).members;
    const bountyDraft = parseTaskCreateDraft({
      kind: "bounty",
      title: "Clear garage",
      stars: 6,
      recurrence: { kind: "once" },
    });
    expect(bountyDraft?.kind).toBe("bounty");
    if (!bountyDraft || bountyDraft.kind !== "bounty") return;

    const completable = createBounty(tasksDatabase(), bountyDraft, today);
    const completableOffering = loadAvailableBounties(
      tasksDatabase(),
      today,
    ).find((row) => row.offering.definition === completable.id);
    const claimCommand = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: completableOffering?.offering,
      member: "a",
      definitionRevision: completableOffering?.definitionRevision,
    });
    expect(claimCommand?.kind).toBe("claim-bounty");
    if (!claimCommand || claimCommand.kind !== "claim-bounty") return;
    const claimReceipt = claimBounty({
      db: tasksDatabase(),
      command: claimCommand,
      today,
      members,
    });
    if (!("result" in claimReceipt)) return;
    if (claimReceipt.result.kind !== "claimed") return;

    const retire = {
      kind: "retire-bounty",
      requestId: crypto.randomUUID(),
      definition: completable.id,
      revision: 0,
    };
    expect((await tasks(retire)).status).toBe(200);
    expect((await tasks(retire)).status).toBe(200);
    const retiredDefinition = loadBountyDefinitions(tasksDatabase()).find(
      (row) => row.id === completable.id,
    );
    expect(retiredDefinition).toMatchObject({ revision: 1 });
    expect(retiredDefinition?.retiredAt).not.toBeNull();
    expect(loadBountyClaims(tasksDatabase())[0]).toMatchObject({
      state: { kind: "unfinished" },
      claim: { title: "Clear garage", stars: 6 },
    });
    const completeCommand = parseBountyCommand({
      kind: "complete-bounty",
      requestId: crypto.randomUUID(),
      claim: claimReceipt.result.claim.id,
      revision: claimReceipt.result.revision,
    });
    expect(completeCommand?.kind).toBe("complete-bounty");
    if (!completeCommand || completeCommand.kind !== "complete-bounty") return;
    completeBounty({ db: tasksDatabase(), command: completeCommand });
    expect(balance("a")).toBe(6);

    const releasable = createBounty(
      tasksDatabase(),
      {
        ...bountyDraft,
        title: "Clear shed" as typeof bountyDraft.title,
      },
      today,
    );
    const releasableOffering = loadAvailableBounties(
      tasksDatabase(),
      today,
    ).find((row) => row.offering.definition === releasable.id);
    const releasableCommand = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: releasableOffering?.offering,
      member: "b",
      definitionRevision: releasableOffering?.definitionRevision,
    });
    expect(releasableCommand?.kind).toBe("claim-bounty");
    if (!releasableCommand || releasableCommand.kind !== "claim-bounty") return;
    const releasableClaim = claimBounty({
      db: tasksDatabase(),
      command: releasableCommand,
      today,
      members,
    });
    if (!("result" in releasableClaim)) return;
    if (releasableClaim.result.kind !== "claimed") return;
    expect(
      (
        await tasks({
          kind: "retire-bounty",
          requestId: crypto.randomUUID(),
          definition: releasable.id,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    const releaseCommand = parseBountyCommand({
      kind: "release-bounty",
      requestId: crypto.randomUUID(),
      claim: releasableClaim.result.claim.id,
      revision: releasableClaim.result.revision,
    });
    expect(releaseCommand?.kind).toBe("release-bounty");
    if (!releaseCommand || releaseCommand.kind !== "release-bounty") return;
    releaseBounty({ db: tasksDatabase(), command: releaseCommand });
    expect(
      loadAvailableBounties(tasksDatabase(), today).some(
        (row) => row.offering.definition === releasable.id,
      ),
    ).toBe(false);

    const neverClaimed = createBounty(
      tasksDatabase(),
      {
        ...bountyDraft,
        title: "Clear attic" as typeof bountyDraft.title,
      },
      today,
    );
    const staleOffering = loadAvailableBounties(tasksDatabase(), today).find(
      (row) => row.offering.definition === neverClaimed.id,
    );
    expect(
      (
        await tasks({
          kind: "retire-bounty",
          requestId: crypto.randomUUID(),
          definition: neverClaimed.id,
          revision: staleOffering?.definitionRevision,
        })
      ).status,
    ).toBe(200);
    const staleClaim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: staleOffering?.offering,
      member: "c",
      definitionRevision: staleOffering?.definitionRevision,
    });
    expect(staleClaim?.kind).toBe("claim-bounty");
    if (!staleClaim || staleClaim.kind !== "claim-bounty") return;
    expect(() =>
      claimBounty({
        db: tasksDatabase(),
        command: staleClaim,
        today,
        members,
      }),
    ).toThrow("no longer available");

    const management = await snapshot();
    expect(management.bountyDefinitions).toHaveLength(3);
    expect(management.bountyClaims).toHaveLength(2);
  });
  test("title, type, time, and stars edit in place without revaluing earlier earnings", async () => {
    const definition = await create();
    complete(definition);
    complete(definition);
    expect(balance("a")).toBe(5);
    const response = await tasks({
      kind: "edit",
      task: definition.id,
      draft: {
        ...draft,
        title: "Kitchen",
        type: "routine",
        time: "08:00",
        stars: 12,
      },
    });
    expect(response.status).toBe(200);
    const updated = (await response.json()).definition;
    expect(updated).toMatchObject({
      id: definition.id,
      lineage: definition.lineage,
      title: "Kitchen",
      stars: 12,
      retiredAt: null,
    });
    expect(balance("a")).toBe(5);
    expect(loadEvents()).toHaveLength(1);
  });
  test("schedule changes replace atomically, retain lineage, and preserve rotation turns", async () => {
    const rotation = { kind: "rotation", order: ["a", "b", "c"] } as const;
    const definition = await create({
      assignment: { kind: rotation.kind, order: [...rotation.order] },
    });
    complete(definition);
    const response = await tasks({
      kind: "edit",
      task: definition.id,
      draft: {
        ...draft,
        title: "New title",
        recurrence: { kind: "weekly", days: ["mon"] },
        assignment: rotation,
      },
    });
    expect(response.status).toBe(200);
    const updated = (await response.json()).definition;
    expect(updated.id).not.toBe(definition.id);
    expect(updated.lineage).toBe(definition.lineage);
    expect(updated.assignment.order).toEqual(["b", "c", "a"]);
    expect(
      loadDefinitions().find((row) => row.id === definition.id),
    ).toMatchObject({ title: "Dishes", stars: 5 });
    expect(
      loadDefinitions().find((row) => row.id === definition.id)?.retiredAt,
    ).not.toBeNull();
    expect(
      (await tasks({ kind: "edit", task: definition.id, draft })).status,
    ).toBe(409);
    expect(loadDefinitions()).toHaveLength(2);
  });
  test("member retirement preserves identity, retires fixed tasks and removes rotation membership", async () => {
    const fixed = await create({ assignment: { kind: "fixed", member: "b" } });
    const rotating = await create({
      assignment: { kind: "rotation", order: ["a", "b", "c"] },
    });
    complete(rotating);
    const bountyDraft = parseTaskCreateDraft({
      kind: "bounty",
      type: "chore",
      title: "Wash patio",
      stars: 4,
      recurrence: { kind: "once" },
    });
    expect(bountyDraft?.kind).toBe("bounty");
    if (!bountyDraft || bountyDraft.kind !== "bounty") {
      throw new Error("Invalid Bounty fixture");
    }
    const bounty = createBounty(tasksDatabase(), bountyDraft, today);
    const offering = loadAvailableBounties(tasksDatabase(), today).find(
      (row) => row.offering.definition === bounty.id,
    );
    expect(offering).toBeDefined();
    const claimCommand = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: offering?.offering,
      member: "b",
      definitionRevision: offering?.definitionRevision,
    });
    expect(claimCommand?.kind).toBe("claim-bounty");
    if (!claimCommand || claimCommand.kind !== "claim-bounty") {
      throw new Error("Invalid claim fixture");
    }
    claimBounty({
      db: tasksDatabase(),
      command: claimCommand,
      today,
      members: (await readHousehold()).members,
    });
    expect(
      (
        await saveMember(
          request("members", { kind: "retire", id: "b", expectedVersion: 1 }),
        )
      ).status,
    ).toBe(200);
    const household = await readHousehold();
    expect(household.members.find((row) => row.id === "b")).toEqual({
      id: "b",
      name: "Bailey",
      status: "retired",
    });
    expect(
      loadDefinitions().find((row) => row.id === fixed.id)?.retiredAt,
    ).not.toBeNull();
    expect(
      loadDefinitions().find(
        (row) => row.lineage === rotating.lineage && row.retiredAt === null,
      )?.assignment,
    ).toEqual({ kind: "rotation", order: ["c", "a"] });
    const released = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.offering.definition === bounty.id,
    );
    expect(released).toMatchObject({
      revision: 1,
      state: { kind: "released" },
    });
    expect(
      loadAvailableBounties(tasksDatabase(), today).some(
        (row) => row.offering.definition === bounty.id,
      ),
    ).toBe(true);
    expect(
      (
        await tasks({
          kind: "create",
          id: crypto.randomUUID(),
          draft: { ...draft, assignment: { kind: "fixed", member: "b" } },
        })
      ).status,
    ).toBe(400);
    // Recovery after a repeated read cannot create additional replacements.
    await snapshot();
    await snapshot();
    expect(loadDefinitions()).toHaveLength(3);
    expect(
      loadBountyClaims(tasksDatabase()).filter(
        (row) => row.claim.offering.definition === bounty.id,
      ),
    ).toHaveLength(1);
  });
  test("membership validation and concurrent edits preserve the roster", async () => {
    const collision = await saveMember(
      request("members", {
        kind: "create",
        id: crypto.randomUUID(),
        name: "Duplicate color",
        color: "#a9d8d2",
        expectedVersion: 1,
      }),
    );
    expect(collision.status).toBe(400);
    const edits = await Promise.all([
      saveMember(
        request("members", {
          kind: "edit",
          id: "a",
          name: "First",
          color: "#a9d8d2",
          expectedVersion: 1,
        }),
      ),
      saveMember(
        request("members", {
          kind: "edit",
          id: "a",
          name: "Second",
          color: "#a9d8d2",
          expectedVersion: 1,
        }),
      ),
    ]);
    expect(edits.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await readHousehold()).members).toHaveLength(3);
    expect((await readHousehold()).configVersion).toBe(2);
  });
  test("undo, restore and reattribute completions preserve original events and stored credit", async () => {
    const definition = await create();
    complete(definition);
    const original = loadEvents();
    const undo = {
      kind: "correct",
      id: crypto.randomUUID(),
      task: definition.id,
      window: today,
      by: null,
      reason: "Tapped accidentally",
      previous: null,
    };
    expect((await tasks(undo)).status).toBe(200);
    expect((await tasks(undo)).status).toBe(200);
    expect(balance("a")).toBe(0);
    expect(loadEvents()).toEqual(original);
    let data = await snapshot();
    expect(view(data.definitions, data.events, today)[0]?.state).toBe(
      "skipped",
    );
    const restored = {
      ...undo,
      id: crypto.randomUUID(),
      previous: undo.id,
      by: "b",
      reason: "Bailey did it",
    };
    expect((await tasks(restored)).status).toBe(200);
    expect(balance("b")).toBe(5);
    expect(balance("a")).toBe(0);
    data = await snapshot();
    expect(view(data.definitions, data.events, today)[0]).toMatchObject({
      state: "done",
      by: "b",
    });
    expect(data.corrections).toHaveLength(2);
    expect(loadEvents()).toEqual(original);
    expect(
      (await tasks({ ...restored, id: crypto.randomUUID(), previous: null }))
        .status,
    ).toBe(409);
  });
  test("undo reopens the original Bounty Claim and reverses its recorded credit", async () => {
    const original = await completedBounty({ stars: 4 });
    const before = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === original.claim.id,
    );
    expect(before?.state.kind).toBe("completed");

    const requestId = crypto.randomUUID();
    const undo = {
      kind: "undo-bounty-completion",
      requestId,
      claim: original.claim.id,
      revision: before?.revision,
      completion: original.completion.id,
      predecessor: null,
      reason: "Tapped accidentally",
    };
    const response = await tasks(undo);
    expect(response.status).toBe(200);
    expect((await response.json()).receipt).toMatchObject({
      status: "accepted",
      result: { kind: "undone", claim: { revision: 2 } },
    });
    expect(balance("a")).toBe(0);
    expect(loadBountyClaims(tasksDatabase())).toContainEqual(
      expect.objectContaining({
        claim: original.claim,
        revision: 2,
        state: expect.objectContaining({
          kind: "reopened",
          undoneCompletion: expect.objectContaining({
            id: original.completion.id,
          }),
        }),
      }),
    );

    closeTasksDatabase();
    const replay = await tasks(undo);
    expect(replay.status).toBe(200);
    expect((await replay.json()).receipt.status).toBe("already-applied");
    expect(balance("a")).toBe(0);
  });
  test("Bounty Undo rejects atomically when the credited balance was spent", async () => {
    const original = await completedBounty({ stars: 4 });
    const completed = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === original.claim.id,
    );
    expect(
      (
        await tasks({
          kind: "adjust-stars",
          id: crypto.randomUUID(),
          member: "a",
          delta: -4,
          reason: "Already spent",
        })
      ).status,
    ).toBe(200);
    const response = await tasks({
      kind: "undo-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: completed?.revision,
      completion: original.completion.id,
      predecessor: null,
      reason: "Wrong completion",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "This correction would make the credited member's Star Balance negative. Adjust the balance first.",
    });
    const after = await snapshot();
    expect(
      after.bountyClaims.find((row) => row.claim.id === original.claim.id),
    ).toMatchObject({ revision: 1, state: { kind: "completed" } });
    expect(after.bountyCompletionCorrections).toEqual([]);
    expect(balance("a")).toBe(0);
  });
  test("Restore reinstates the original Bounty Completion identity, time, and credit", async () => {
    const original = await completedBounty({ stars: 4 });
    const completed = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === original.claim.id,
    );
    const undo = await tasks({
      kind: "undo-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: completed?.revision,
      completion: original.completion.id,
      predecessor: null,
      reason: "Check again",
    });
    const undone = (await undo.json()).receipt;
    const restore = {
      kind: "restore-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: undone.result.claim.revision,
      completion: original.completion.id,
      predecessor: undone.result.correction.id,
      reason: "Completion was correct",
    };
    const restored = await tasks(restore);
    expect(restored.status).toBe(200);
    expect((await restored.json()).receipt).toMatchObject({
      status: "accepted",
      result: { kind: "restored", claim: { revision: 3, state: "completed" } },
    });
    const after = (await snapshot()).bountyClaims.find(
      (row) => row.claim.id === original.claim.id,
    );
    expect(after).toMatchObject({
      revision: 3,
      state: {
        kind: "completed",
        completion: {
          id: original.completion.id,
          at: original.completion.at,
          creditedStars: 4,
        },
        creditedTo: "a",
      },
    });
    expect(balance("a")).toBe(4);
    expect((await snapshot()).bountyCompletionCorrections).toHaveLength(2);
    expect((await tasks(restore)).status).toBe(200);
    expect(balance("a")).toBe(4);
  });
  test("Bounty reassignment and later Undo transfer the recorded credit", async () => {
    const original = await completedBounty({ stars: 4 });
    await tasks({
      kind: "edit-bounty",
      requestId: crypto.randomUUID(),
      definition: original.definition.id,
      revision: 0,
      draft: { title: "Wash and wax car", stars: 20 },
    });
    const completed = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === original.claim.id,
    );
    const reassigned = await tasks({
      kind: "reassign-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: completed?.revision,
      completion: original.completion.id,
      predecessor: null,
      member: "b",
      reason: "Bailey did the work",
    });
    expect(reassigned.status).toBe(200);
    const reassignment = (await reassigned.json()).receipt;
    expect(balance("a")).toBe(0);
    expect(balance("b")).toBe(4);
    expect((await snapshot()).bountyClaims[0]).toMatchObject({
      revision: 2,
      state: { kind: "completed", creditedTo: "b" },
    });

    expect(
      (
        await tasks({
          kind: "undo-bounty-completion",
          requestId: crypto.randomUUID(),
          claim: original.claim.id,
          revision: reassignment.result.claim.revision,
          completion: original.completion.id,
          predecessor: reassignment.result.correction.id,
          reason: "Completion was mistaken",
        })
      ).status,
    ).toBe(200);
    expect(balance("a")).toBe(0);
    expect(balance("b")).toBe(0);
    expect((await snapshot()).bountyCompletionCorrections).toMatchObject([
      { kind: "reassign", fromMember: "a", toMember: "b", creditedStars: 4 },
      { kind: "undo", fromMember: "b", toMember: null, creditedStars: 4 },
    ]);
  });
  test("recompletion creates new history and invalidates delayed completion and Restore", async () => {
    const original = await completedBounty({ stars: 4 });
    const before = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === original.claim.id,
    );
    const delayed = parseBountyCommand({
      kind: "complete-bounty",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: before?.revision,
    });
    expect(delayed?.kind).toBe("complete-bounty");
    const undoneResponse = await tasks({
      kind: "undo-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: before?.revision,
      completion: original.completion.id,
      predecessor: null,
      reason: "Try the work again",
    });
    const undone = (await undoneResponse.json()).receipt;
    expect(() => {
      if (!delayed || delayed.kind !== "complete-bounty") return;
      completeBounty({ db: tasksDatabase(), command: delayed });
    }).toThrow("changed");

    const recomplete = parseBountyCommand({
      kind: "complete-bounty",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: undone.result.claim.revision,
    });
    if (!recomplete || recomplete.kind !== "complete-bounty")
      throw new Error("Invalid recompletion fixture");
    const recompleted = completeBounty({
      db: tasksDatabase(),
      command: recomplete,
    });
    if (!("result" in recompleted) || recompleted.result.kind !== "completed")
      throw new Error("Bounty did not recomplete");
    expect(recompleted.result.completion.id).not.toBe(original.completion.id);
    expect(Date.parse(recompleted.result.completion.at)).not.toBeNaN();
    expect(balance("a")).toBe(4);
    expect((await snapshot()).bountyCompletions).toHaveLength(2);

    const staleRestore = await tasks({
      kind: "restore-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: undone.result.claim.revision,
      completion: original.completion.id,
      predecessor: undone.result.correction.id,
      reason: "Too late",
    });
    expect(staleRestore.status).toBe(409);
    expect(balance("a")).toBe(4);
  });
  test("release of reopened work invalidates Restore and permits a new Claim", async () => {
    const original = await completedBounty({ stars: 0 });
    const before = loadBountyClaims(tasksDatabase())[0];
    const undoneResponse = await tasks({
      kind: "undo-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: before?.revision,
      completion: original.completion.id,
      predecessor: null,
      reason: "Not done",
    });
    const undone = (await undoneResponse.json()).receipt;
    const release = parseBountyCommand({
      kind: "release-bounty",
      requestId: crypto.randomUUID(),
      claim: original.claim.id,
      revision: undone.result.claim.revision,
    });
    if (!release || release.kind !== "release-bounty")
      throw new Error("Invalid release fixture");
    expect(
      releaseBounty({ db: tasksDatabase(), command: release }),
    ).toMatchObject({ status: "accepted", result: { kind: "released" } });
    expect(
      (
        await tasks({
          kind: "restore-bounty-completion",
          requestId: crypto.randomUUID(),
          claim: original.claim.id,
          revision: undone.result.claim.revision,
          completion: original.completion.id,
          predecessor: undone.result.correction.id,
          reason: "Too late",
        })
      ).status,
    ).toBe(409);
    const offering = loadAvailableBounties(tasksDatabase(), today).find(
      (row) => row.offering.definition === original.definition.id,
    );
    expect(offering).toBeDefined();
    if (!offering) return;
    const claim = parseBountyCommand({
      kind: "claim-bounty",
      requestId: crypto.randomUUID(),
      offering: offering.offering,
      member: "b",
      definitionRevision: offering.definitionRevision,
    });
    if (!claim || claim.kind !== "claim-bounty")
      throw new Error("Invalid reclaimed fixture");
    const reclaimed = claimBounty({
      db: tasksDatabase(),
      command: claim,
      today,
      members: (await readHousehold()).members,
    });
    expect(reclaimed).toMatchObject({
      status: "accepted",
      result: { kind: "claimed", claim: { member: "b" } },
    });
    if ("result" in reclaimed && reclaimed.result.kind === "claimed")
      expect(reclaimed.result.claim.id).not.toBe(original.claim.id);
  });
  test("Undo releases a retired claimant but keeps active claimants on retired definitions", async () => {
    const retiredClaimant = await completedBounty({ member: "a" });
    const first = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === retiredClaimant.claim.id,
    );
    const household = await readHousehold();
    await writeHousehold({
      ...household,
      members: household.members.map((member) =>
        member.id === "a"
          ? { id: member.id, name: member.name, status: "retired" as const }
          : member,
      ),
      configVersion: household.configVersion + 1,
    });
    const retiredUndo = await tasks({
      kind: "undo-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: retiredClaimant.claim.id,
      revision: first?.revision,
      completion: retiredClaimant.completion.id,
      predecessor: null,
      reason: "Alex has retired",
    });
    expect(retiredUndo.status).toBe(200);
    expect((await retiredUndo.json()).receipt.result.claim).toMatchObject({
      revision: 3,
      state: "released",
    });
    expect(loadAvailableBounties(tasksDatabase(), today)).toContainEqual(
      expect.objectContaining({
        offering: expect.objectContaining({
          definition: retiredClaimant.definition.id,
        }),
      }),
    );

    const activeClaimant = await completedBounty({ member: "b" });
    expect(
      (
        await tasks({
          kind: "retire-bounty",
          requestId: crypto.randomUUID(),
          definition: activeClaimant.definition.id,
          revision: 0,
        })
      ).status,
    ).toBe(200);
    const second = loadBountyClaims(tasksDatabase()).find(
      (row) => row.claim.id === activeClaimant.claim.id,
    );
    const activeUndo = await tasks({
      kind: "undo-bounty-completion",
      requestId: crypto.randomUUID(),
      claim: activeClaimant.claim.id,
      revision: second?.revision,
      completion: activeClaimant.completion.id,
      predecessor: null,
      reason: "Bailey should redo it",
    });
    expect(activeUndo.status).toBe(200);
    expect((await activeUndo.json()).receipt.result.claim.state).toBe(
      "reopened",
    );
    expect(
      loadAvailableBounties(tasksDatabase(), today).some(
        (offering) =>
          offering.offering.definition === activeClaimant.definition.id,
      ),
    ).toBe(false);
  });
  test("retired claimant release reopens only the current recurring interval", async () => {
    const recurring = await completedBounty({
      recurrence: {
        kind: "recurring",
        startsOn: today,
        cadence: { kind: "daily" },
      },
    });
    const completed = loadBountyClaims(tasksDatabase())[0];
    const household = await readHousehold();
    await writeHousehold({
      ...household,
      members: household.members.map((member) =>
        member.id === "a"
          ? { id: member.id, name: member.name, status: "retired" as const }
          : member,
      ),
      configVersion: household.configVersion + 1,
    });
    expect(
      (
        await tasks({
          kind: "undo-bounty-completion",
          requestId: crypto.randomUUID(),
          claim: recurring.claim.id,
          revision: completed?.revision,
          completion: recurring.completion.id,
          predecessor: null,
          reason: "Claimant retired",
        })
      ).status,
    ).toBe(200);
    expect(
      loadAvailableBounties(tasksDatabase(), today).find(
        (offering) => offering.offering.definition === recurring.definition.id,
      )?.offering,
    ).toEqual({
      kind: "recurring",
      definition: recurring.definition.id,
      intervalStart: today,
    });

    const tomorrow = parseLocalDate("2026-09-09");
    if (!tomorrow) throw new Error("Invalid tomorrow fixture");
    const tomorrowOffering = loadAvailableBounties(
      tasksDatabase(),
      tomorrow,
    ).find(
      (offering) => offering.offering.definition === recurring.definition.id,
    );
    expect(tomorrowOffering?.offering).toEqual({
      kind: "recurring",
      definition: recurring.definition.id,
      intervalStart: tomorrow,
    });
    expect(tomorrowOffering?.id).not.toBe(
      loadAvailableBounties(tasksDatabase(), today).find(
        (offering) => offering.offering.definition === recurring.definition.id,
      )?.id,
    );
  });
  test("correction uses stars captured at completion time after definition edits", async () => {
    const definition = await create();
    complete(definition);
    await tasks({
      kind: "edit",
      task: definition.id,
      draft: { ...draft, stars: 20 },
    });
    correctAdminCompletion({
      id: crypto.randomUUID(),
      task: definition.id,
      window: today,
      by: "b",
      reason: "Attribution",
      at: nowInstant(),
      previous: null,
    });
    expect(balance("a")).toBe(0);
    expect(balance("b")).toBe(5);
  });
  test("insufficient balance rejects a correction without partial history or credits", async () => {
    const definition = await create();
    complete(definition);
    await tasks({
      kind: "adjust-stars",
      id: crypto.randomUUID(),
      member: "a",
      delta: -5,
      reason: "Spent",
    });
    const correction = {
      kind: "correct",
      id: crypto.randomUUID(),
      task: definition.id,
      window: today,
      by: "b",
      reason: "Wrong person",
      previous: null,
    };
    expect((await tasks(correction)).status).toBe(409);
    expect((await snapshot()).corrections).toHaveLength(0);
    expect(balance("a")).toBe(0);
    expect(balance("b")).toBe(0);
  });
  test("star adjustments are nonzero, nonnegative, append-only and retry-safe", async () => {
    const grant = {
      kind: "adjust-stars",
      id: crypto.randomUUID(),
      member: "a",
      delta: 10,
      reason: "Correction",
    };
    expect((await tasks(grant)).status).toBe(200);
    expect((await tasks(grant)).status).toBe(200);
    expect(balance("a")).toBe(10);
    expect((await tasks({ ...grant, delta: 20 })).status).toBe(409);
    for (const delta of [0, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        (await tasks({ ...grant, id: crypto.randomUUID(), delta })).status,
      ).toBe(400);
    expect(
      (await tasks({ ...grant, id: crypto.randomUUID(), delta: -11 })).status,
    ).toBe(409);
    expect(balance("a")).toBe(10);
    expect(() => tasksDatabase().exec("DELETE FROM star_adjustments")).toThrow(
      /append-only/,
    );
    expect((await snapshot()).adjustments).toHaveLength(1);
  });
  test("retired members retain balances and accept corrections", async () => {
    await saveMember(
      request("members", { kind: "retire", id: "a", expectedVersion: 1 }),
    );
    expect(
      (
        await tasks({
          kind: "adjust-stars",
          id: crypto.randomUUID(),
          member: "a",
          delta: 3,
          reason: "Historical correction",
        })
      ).status,
    ).toBe(200);
    expect(balance("a")).toBe(3);
  });
  test("new late completions on retired definitions still credit once", async () => {
    const definition = await create();
    await tasks({ kind: "retire", task: definition.id });
    expect(complete(definition).status).toBe("inserted");
    expect(complete(definition).status).toBe("already-present");
    expect(balance("a")).toBe(5);
  });
});
