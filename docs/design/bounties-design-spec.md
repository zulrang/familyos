# Bounties

Design confirmed by the user. This confirms the design only; implementation
has not started and application code has not been changed during this interview.
See [ADR 0008](../adr/0008-bounty-availability-and-claimed-work.md) for the
lifecycle trade-off. This design revises open-task behavior in the existing
[Tasks design](tasks-design-spec.md).

## Settled behavior

- Bounties are Chores only. Existing open Routines become Chores/Bounties,
  preserving their history.
- Available offerings have no scheduled work date. Claiming reserves work for
  one Active Member and schedules it for today in the Household Time Zone.
- Once offerings persist until claimed; claimed Once work persists until done
  or released.
- Recurring offerings follow fixed calendar intervals with a starting date.
  Unclaimed offerings expire at the next interval, with no missed backlog.
  Claimed work survives and a new offering appears at the next interval.
- Releasing a claim from an older interval drops that commitment without
  adding an old offering. Member retirement automatically releases claims.
- No Skip action exists for Bounties. Unwanted Bounties can be retired.
- Releasing a Once claim or a claim within its original recurring interval
  reopens the offering while its definition is active. Reclaiming schedules
  it for the new claim day and captures the currently advertised reward.
- Retiring a Bounty stops offerings but preserves existing claims until done
  or released. Release cannot reopen an offering from a retired definition.
- One member may claim multiple intervals of the same Bounty; each represents
  separate work and a separate completion reward.
- Claiming captures the advertised Star reward. Later edits do not change an
  existing claim's reward; completion awards that captured value.
- Available work has a dedicated Bounties view. Claimed work stays with its
  member. Both display the Star reward for completion.
- Claiming preserves the accepted description. Description edits affect
  available and future work, not existing claims. Currently the only work
  description field is the title; a separate instructions field is not implied.
- Reuse the focus screen inside Tasks with an always-visible Bounties entry
  and an Add Bounty action; do not add a main-rail navigation item.
- Show available offerings first, with a Manage Bounties entry for all
  definitions, including those with no currently available work.
- Once Bounties are available immediately and have no date input. Bounties
  have no optional time field; claims carry a scheduled date only.
- A recurring schedule edit replaces the unclaimed old offering. The new
  schedule first offers work on its next matching date on or after the edit,
  bounded by its starting date. Existing claims remain intact.
- Administrators may convert between Bounties and assigned Chores using
  retire-and-replace, preserving existing Bounty claims and history.

## Completion corrections

- Administrative Undo reverses the completion's Star credit and reopens the
  original claim as unfinished work, retaining its accepted title, scheduled
  date, and captured reward. This replaces the existing synthetic-Skip
  behavior for Bounties; other Tasks keep their current correction behavior.
- A reopened claim may be completed again. The earlier completion and its
  reversal remain in history; a new completion needs its own receipt so it
  can award the captured reward once without replaying the old credit.
- If the original claimant is retired, immediately apply normal Release
  rules to the reopened claim. Only an active Once/current-interval offering
  returns to availability. Retiring the definition alone does not prevent
  reopening work for a still-active claimant.
- Reject Undo atomically if reversing its actual completion credit would make
  the credited member's balance negative. Leave completion and claim state
  unchanged, and explain that the balance must first be adjusted.
- Restore is allowed only while the original reopened claim remains
  unfinished and unreleased. Release, reclaim, or a new completion invalidates
  the old Restore action. Existing administrative completion reassignment
  remains available and transfers the recorded credit, not today's reward.
- Restore reinstates the original completion and its actual credit. Completing
  reopened work again records a new completion time and awards the claim's
  captured reward. Neither path may leave two effective completions or two
  net credits for the same offering. Stars Earned follows effective completion
  history, excluding reversed completions.

## Migration

- Restore all active unfinished Once household chores, including those
  previously skipped or hidden by expiration. Completed and explicitly
  retired definitions do not produce new offerings, and effective completions
  stay completed.
- Legacy administratively undone completions reopen their recorded claim,
  if one exists; otherwise return only an active Once/current-interval
  offering. Apply normal Release rules if the claimant is retired. Do not
  reverse an already-reversed credit again during migration.
- Preserve legacy claimants and original occurrence dates; actual claim dates
  were not recorded. Capture the current description and Star reward for
  unfinished legacy claims.
- Preserve history and existing credits without replaying completions or
  awarding Stars again. Open Routines migrate to Chores/Bounties.
- Automatically release claims held by retired members using normal release
  rules; do not migrate an unfinished claim to an ineligible claimant.

## Type-first constraints

- A Bounty is a Chore variant; Routine plus Bounty is not a legal combination.
- An available offering has no claimant or scheduled work date. A claimed
  occurrence requires a claimant, scheduled date, captured description, and
  captured Star reward.
- A Once offering has no required recurrence date. A recurring offering has a
  calendar interval identity distinct from the date assigned at Claim.
- Bounty definitions and claim snapshots omit time-of-day fields. A Once
  definition omits dates; recurring definitions require a starting date.
- An offering's identity survives Claim; changing the scheduled work date
  cannot identify a different offering or permit duplicate completion credit.
- Claim, Release, and Complete are explicit transitions; Skip is unavailable.
- Reclaiming creates a distinct claim identity for the same offering so an
  action on a released claim cannot accidentally complete its replacement.
- Definition retirement and claim completion are independent: a retired
  definition may still have unfinished claims.
- Undo is a transition from completed back to claimed, not an artificial
  Skip. Claim identity survives Undo, while completion attempts have distinct
  identities and retry receipts.
- Concurrent claims must reserve the offering for only one member. Retrying
  completion must not award Stars twice. These require atomic persistence
  guarantees in addition to types.

## Proposed type shape

This is the domain contract to encode before implementing behavior. Existing
validated IDs and calendar values are reused; additional branded values are
constructed at boundaries. Persistence layout is an implementation choice.

```ts
type TaskDefinition = AssignedTaskDefinition | BountyDefinition;

type AssignedTaskDefinition = DefinitionIdentity & {
  kind: 'assigned';
  type: 'chore' | 'routine';
  title: TaskTitle;
  stars: StarAmount;
  assignment: FixedAssignment | RotationAssignment;
  recurrence: AssignedRecurrence; // Includes dated Once.
  time: LocalTime | null;
};

type BountyDefinition = DefinitionIdentity & {
  kind: 'bounty';
  type: 'chore';
  title: TaskTitle;
  stars: StarAmount;
  recurrence:
    | { kind: 'once' }
    | { kind: 'recurring'; startsOn: LocalDate; cadence: CalendarCadence };
};

type CalendarCadence =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: NonEmptyDistinctWeekdays }
  | { kind: 'monthly'; day: DayOfMonth };

type OfferingKey =
  | { kind: 'once'; definition: TaskId }
  | { kind: 'recurring'; definition: TaskId; intervalStart: LocalDate };

type AvailableBounty = {
  kind: 'available';
  offering: OfferingKey;
  title: TaskTitle;
  stars: StarAmount;
};

type BountyClaim = Readonly<{
  id: ClaimId;
  offering: OfferingKey;
  member: MemberId;
  scheduledOn: LocalDate;
  title: TaskTitle;
  stars: StarAmount;
}>;

type ClaimedBounty = {
  claim: BountyClaim;
  revision: ClaimRevision;
  state:
    | { kind: 'unfinished' }
    | { kind: 'reopened'; undoneCompletion: CompletionId }
    | { kind: 'completed'; completion: CompletionId }
    | { kind: 'released' };
};

type BountyCompletion = Readonly<{
  id: CompletionId;
  claim: ClaimId;
  by: MemberId;
  at: Instant;
  creditedStars: StarAmount;
}>;
```

`DefinitionIdentity` holds ID, Lineage, and lifecycle metadata. A retired
definition remains readable for claim snapshots and history. `TaskTitle` is
trimmed and nonempty; `StarAmount` is a nonnegative safe integer, including
zero. Calendar values are validated dates in the Household Time Zone;
recurrence retains the existing daily, selected-weekday, and monthly-day
capabilities (monthly days 1–28). No new recurrence modes are implied.

These unions remove open Routines, dated available Once offerings, time fields
on Bounties, and claims without snapshots from the legal domain shapes. Input
schemas must also reject incompatible fields; TypeScript alone does not make
objects exact. Membership eligibility, interval freshness, current definition
status, and revision checks are enforced when commands are accepted.

Offering identity is stable through release/reclaim, but each reservation gets
a new ClaimId. Undo keeps that ClaimId and advances its revision. A completion
command carries the expected claim revision and a retry identity: a delayed
retry from before Undo cannot complete reopened work. The same principle
guards Restore and other corrections. Transactions couple each accepted state
transition to its balance changes and history receipt.

## Transition table

| From / trigger | Result | Stars |
| --- | --- | --- |
| Available → Claim | Reserve for one Active Member; capture today's date, title, reward | None |
| Claimed → Complete | Completed; record one completion receipt | Credit captured reward once |
| Claimed → Release, active Once/current interval | Release claim; reopen same offering | None |
| Claimed → Release, old interval/retired definition | Release claim; no offering reopened | None |
| Recurring interval ends | Expire unclaimed offering; open next interval; preserve claims | None |
| Retire definition / convert / change schedule | Stop old offerings; preserve claims; replacement follows its own schedule | None |
| Retire claimant | Release unfinished claims by the rules above | None |
| Completed → Undo | Reopen original claim; release if claimant retired | Reverse actual credit atomically; reject insufficient balance |
| Reopened → Complete | New effective completion, retaining accepted work | Credit captured reward once |
| Reopened → Restore | Reinstate original completion, only if claim remains unfinished and unreleased | Reinstate original credit once |

Available offerings are separate from member progress; claiming moves work
to the claimant's tasks. Old unfinished claims remain visible there alongside
newer claims. Normal completion credits the claimant; administrative credit
corrections preserve the audit history. Claim selection and errors use the
existing shared-display interaction model.

## Implementation and verification sequence

1. Encode the definition, offering, claim, completion, and command types and
   their boundary schemas before changing behavior.
2. Implement pure availability and transition rules, including calendar
   rollover, release, claim snapshots, retirement, and correction eligibility.
3. Add atomic persistence and an idempotent migration. Preserve legacy IDs,
   completion credits, corrections, and balances; recover data through the
   migration rules above instead of replaying reward-producing commands.
4. Integrate the Tasks Bounties view, member claims, contextual creation,
   Manage Bounties, and Star values. Remove Bounty date/time/Skip inputs.
5. Verify persistence across multiple days, overlapping claims, calendar edit
   boundaries, same-interval and expired releases, immutable snapshots,
   member/definition retirement, duplicate and racing commands, Undo/Restore
   and insufficient balances, and migrations including legacy corrections.
   Exercise UI behavior and run the repository's relevant test, contract,
   type, and lint checks.

Update the existing Tasks spec's superseded open-assignment rules alongside
implementation so the docs describe the shipped behavior consistently.
