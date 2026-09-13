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
      assignment: { kind: "open" },
    });
    const metadataEdit = {
      kind: "edit",
      task: legacy.id,
      draft: {
        ...draft,
        title: "Morning checklist",
        type: "routine",
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
        recurrence: { kind: "daily" },
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
            recurrence: { kind: "weekly", days: ["mon"] },
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
