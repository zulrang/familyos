# Tasks — Technical Design Specification

**Status:** Approved for implementation
**Date:** 2026-08-25 (supersedes `chores-design-spec.md`, 2026-08-23)
**Audience:** Implementing developer

Domain terms (Task, Chore, Routine, Occurrence, Window, Rotation, Claim, Skip)
are defined in `CONTEXT.md`. The storage-ownership decision is recorded in
`docs/adr/0006-familyos-owned-task-store.md`.

---

## 1. Overview and Scope

This document specifies the Tasks surface of FamilyOS. The Server Installation
holds all Task data and computes all views. Trusted Displays read the
projection and submit events over the LAN. There is no external provider:
unlike Calendar and Lists, Task data is FamilyOS-owned (ADR 0006).

### In scope

- Recurring and one-time Task Definitions, each typed Chore or Routine
- Rotation, fixed, and open assignment
- Completion, claiming, and skipping
- Retire-and-replace definition editing, including the Household Member
  retirement hook
- The Tasks screen: per-member columns plus a Household column for open Tasks

### Explicitly out of scope

Considered and rejected or deferred. See the Decision Log (Section 3).

- **Verification.** The `verified` event kind and its invariant stay in the
  schema so it is additive later, but no workflow or UI ships (D10).
- **Rewards.** No points, stars, or reward logic. The kit's points pill is
  omitted (`points` is optional in `MemberColumn`) (D11).
- **Device offline queue and staleness indicator.** Displays are LAN browsers;
  if the server is down the whole app is down (D12).
- **Historical views.** The projection looks back one Window at most, and the
  wall hides `expired` occurrences entirely (D13).
- **Carryover.** A missed Task does not roll into a new Occurrence.
- **Delta sync.** The server sends the full projection on every fetch.
- **Conflict resolution logic.** The event key makes merges idempotent.
- **In-place updates.** Definitions and events are append-only. The only
  exception is `retiredAt`, a write-once field.
- **Time-of-day sections.** No Morning/Afternoon/Evening/Chores tabs; one flat
  list per column ordered by the optional time field (D14).

---

## 2. Domain Model

### 2.1 Types

```ts
type TaskId    = Branded<string, 'TaskId'>
type LineageId = Branded<string, 'LineageId'>
type MemberId  = Branded<string, 'MemberId'>    // stable Household Member ID
type LocalDate = Branded<string, 'LocalDate'>   // ISO date; Household Time Zone
type LocalTime = Branded<string, 'LocalTime'>
type Instant   = Branded<string, 'Instant'>     // ISO timestamp, UTC

type TaskType = 'chore' | 'routine'             // identical behavior; label only in v1

type Recurrence =
  | { kind: 'once'; date: LocalDate }
  | { kind: 'daily' }
  | { kind: 'weekly'; days: NonEmptySet<Weekday> }
  | { kind: 'monthly'; day: DayOfMonth }        // constrain to 1–28

type AssignmentPolicy =
  | { kind: 'fixed'; member: MemberId }
  | { kind: 'rotation'; order: NonEmptyArray<MemberId> }
  | { kind: 'open' }                            // first member to claim

type TaskDefinition = {
  id: TaskId                   // immutable; a new id per edit
  lineage: LineageId           // stable across versions; used for UI grouping
  title: string
  type: TaskType
  recurrence: Recurrence
  assignment: AssignmentPolicy
  time: LocalTime | null       // optional within-day time; drives column ordering
  retiredAt: LocalDate | null  // write-once; null = active
}

type Event =
  | { kind: 'completed'; task: TaskId; window: LocalDate; by: MemberId; at: Instant }
  | { kind: 'verified';  task: TaskId; window: LocalDate; by: MemberId; at: Instant } // schema only; no v1 workflow
  | { kind: 'claimed';   task: TaskId; window: LocalDate; by: MemberId }
  | { kind: 'skipped';   task: TaskId; window: LocalDate; reason: string | null }
```

`TaskType` has no effect on windows, rotation, or rendering in v1. It is
captured at creation and stored as a future hook (Rewards will count Chores).

### 2.2 Storage

SQLite via the built-in `node:sqlite` module (Node 24; zero new dependencies).
One database file under `data/`, gitignored like all server-local state.

Two append-only tables:

| Table | Key | Mutability |
|---|---|---|
| `definitions` | `id` | Append-only. `retiredAt` is set exactly once, from null to a date. |
| `events` | `(task, window, kind)` unique | Append-only. Never updated or deleted. |

Enforce the unique event key and invariant 2 as SQL constraints; enforce the
write-once `retiredAt` transition in the single writer.

### 2.3 Windows

An Occurrence is one dated instance of a Task. Its identity is
`(TaskId, window)`, where `window` is the scheduled start date.

The **Window** of an Occurrence is the span from its scheduled date to the
next scheduled date:

```
weekly Task, scheduled Monday:
window = [thisMonday, nextMonday)
```

An Occurrence is open for its whole Window. It becomes `expired` only when the
next Window begins. A weekly Task missed on Monday stays visible and due
through Sunday. There is no recreation of missed Occurrences.

Window rules per recurrence kind:

- `once`: window = `[date, date + 1 day)`
- `daily`: window = `[date, date + 1 day)`
- `weekly`: window = `[scheduled day, next scheduled day)` — with multiple days per week, each scheduled day starts its own window
- `monthly`: window = `[scheduled date, next scheduled date)`

All dates and day boundaries use the Household Time Zone.

### 2.4 Occurrence States (derived, not stored)

The projection derives one state per Occurrence:

```ts
type Occurrence =
  | { state: 'pending'; assignee: MemberId | null }   // null = open, unclaimed
  | { state: 'claimed'; by: MemberId }
  | { state: 'done';    by: MemberId; at: Instant }
  | { state: 'skipped'; reason: string | null }
  | { state: 'expired' }
```

### 2.5 Invariants

Enforce these at the type or SQL-constraint level:

1. `(task, window, kind)` is unique in the events table.
2. A `verified` event requires an existing `completed` event with the same
   `(task, window)`. (Kept even though no v1 workflow emits `verified`.)
3. `retiredAt` transitions once: null → date. Never date → null, never date → other date.
4. `DayOfMonth` accepts 1–28 only. Reject 29–31 at the type level.
5. `rotation.order` and `weekly.days` are non-empty.
6. Every `MemberId` in an assignment references an Active Member at write
   time. (Retirement then edits definitions, not the other way around — see
   Section 4.4.)

There is **no** invariant that a submitted `window` must match the current
window. See Section 5.3.

---

## 3. Decision Log

These decisions are final. Each rejected alternative caused a concrete
problem. Do not reintroduce the alternatives. D1–D9 carry over from the
original chore spec; D10–D18 were settled in the 2026-08-25 design session.

| # | Decision | Rejected alternative | Reason |
|---|---|---|---|
| D1 | Store definitions and events. Derive Occurrences as a pure projection. | Materialized occurrence rows | Materialized rows require migration on every definition edit. |
| D2 | Window semantics for missed Tasks. An Occurrence stays open until the next Window starts, then becomes `expired`. | Expire-and-recreate | Recreation stores synthetic rows that are not derivable from definitions. That breaks the pure projection. Window semantics produce the same visible result. |
| D3 | Verification is optional metadata on a completion. | A `verified` workflow state after `done` | A required verification state doubles the workflow. Completion is trust-based. |
| D4 | Rotation advances on completion only. Assignee = `order[completedCount % order.length]`. | Calendar rotation (assignee as a pure function of the date) | The family wants fairness by turns taken, not by dates elapsed. |
| D5 | Definitions are immutable. An edit retires the old row and inserts a new row with the same `lineage` and a new `id`. | Mutable "active version" definitions | Mutable definitions require the server to reject writes against stale windows after an edit. Immutable definitions make stale writes valid and inert. |
| D6 | An edit resets the rotation fold. The edit flow copies the old `order` and pre-rotates it by the old completion count. | Folding the rotation count across `lineage` | Cross-version folds require reasoning about `order` changes mid-rotation. Scoping the fold to one immutable `id` keeps it trivial. |
| D7 | `skipped` does not advance the rotation. | Skips advance the turn | Ad hoc adjustment is easy for a family. Keep the fold on `completed` only. If a Task needs skip-advancement, edit the definition. |
| D8 | Full projection on every fetch. | Delta sync | The dataset is tens of rows. Full sends delete a class of consistency bugs. |
| D9 | The server accepts every syntactically valid event. The projection decides relevance. | Server-side window-freshness validation | Rejecting late events loses real facts. A late completion still advances the rotation correctly. |
| D10 | Verification is deferred: schema and invariant only, no workflow or UI. | Shipping verification in v1 | A shared no-login wall cannot distinguish the verifier from the completer. Deferring costs nothing because D3 already made it optional metadata. |
| D11 | Rewards stay out. The Tasks screen shows done/total progress only. | A point-per-completion counter now | Rewards is its own rail surface and deserves its own design pass; bolting points on becomes accidental product. |
| D12 | No Display-side offline queue or staleness indicator. The idempotent `(task, window, kind)` key stays. | The original spec's offline tolerance | A Display is a LAN browser next to the server; it does not roam. The event key costs one unique constraint and keeps plain HTTP retries safe. Reintroduce the queue if companion surfaces become real — the event model already supports it. |
| D13 | The wall hides `expired` Occurrences. | Showing last window's missed Tasks, muted | Window semantics already keep a missed Task visible all window. Expired means the calendar moved on. Projection support remains for a future review screen. |
| D14 | Tasks are typed `chore \| routine` with no sections and no behavioral difference. One flat list per column, ordered by the optional time field. | Time-of-day section field; sections derived from time | The family model is simpler: a Routine is a personal-care step, a Chore is household work, otherwise identical. Sections and `TimeOfDayTabs` are dropped from v1. |
| D15 | Completion is attributed to the current assignee automatically; a member picker appears only for unclaimed open Tasks. | Member picker on every completion | A picker on every tap turns a one-tap fridge-whiteboard interaction into two taps. The model is trust-based (D3). |
| D16 | Open, unclaimed Tasks render in a Household column appended to the member grid. | Duplicating into every column with the multi-member stripe; an "up for grabs" strip | Mirrors the Household Event concept and keeps each Task in exactly one place, so done/total counts stay honest. |
| D17 | Retiring a Household Member auto-performs the standard retire-and-replace edit on affected definitions: rotations drop the member (pre-rotated per §4.3), fixed Tasks are retired and surfaced for recreation. | Blocking retirement on manual edits; projection silently skipping retired members | Reuses the one edit flow that exists and keeps the projection pure and ignorant of member state. |
| D18 | FamilyOS-owned store in `node:sqlite`. | Google Tasks as the store; JSON files like Household Configuration | Rotation, windows, and append-only events do not map onto tasklist rows. The invariants want real unique constraints and transactions; `node:sqlite` provides them with zero new dependencies. See ADR 0006. |

---

## 4. API Contract

Route naming follows the existing slice HTTP conventions (`src/tasks/`
mirrors `src/lists/lists-http.ts`). All routes require a Trusted Display
credential, like every household read/write.

### 4.1 `POST` events

Accepts a batch of events from a Display.

Write path, in order:

1. Validate each event structurally against the `Event` type.
2. Check invariant 2 (`verified` requires `completed`).
3. Insert. On unique-key conflict `(task, window, kind)`: treat as success.
   Do not error.

Response: per-event status. `inserted` and `already-present` are both success.

There are exactly two checks on this path. Do not add more. In particular, do
not validate that `window` matches the current window, and do not validate
that the `task` id is active. See D5 and D9.

### 4.2 `GET` view

Returns the full projection for today: an `Occurrence[]` with Task title,
type, lineage, assignee, state, and time, plus per-member done/total counts.
Include the server timestamp of the projection in the response.

### 4.3 Definition editing

Creating and editing Tasks happens in the Tasks surface itself (Section 6),
not in Settings. An edit is one transaction:

1. Set `retiredAt = today` on the old definition.
2. Insert a new definition: same `lineage`, new `id`, new field values.
3. If the assignment is a rotation: copy the old `order`, rotate it left by
   `count(completed events for old id) mod order.length`, and store the
   rotated array as the new `order`.

Step 3 makes the rotation reset invisible to users. The correct person stays
on turn.

### 4.4 Household Member retirement hook

When Settings retires a member, the server applies the Section 4.3 edit to
every active definition referencing that member, in the same operation:

- `rotation`: new definition with the member removed from the pre-rotated
  `order`. If the order would become empty, retire the definition instead.
- `fixed`: retire the definition (no replacement). The Tasks surface lists
  these so the family can recreate them with a new assignee.

The projection never consults member state (D17).

---

## 5. Projection Semantics

### 5.1 Signature

```
view(definitions, events, today) -> Occurrence[]
```

Pure and total. No side effects. No clock reads inside the function; `today`
is an input.

### 5.2 Algorithm

1. Select definitions where `retiredAt` is null.
2. For each definition, compute the window that contains `today`, and the
   previous window. Ignore all older windows. This is the **one-window
   lookback rule**.
3. For each `(id, window)` pair, fold the events with that key into a state:
   - `completed` present → `done`
   - else `skipped` present → `skipped`
   - else `claimed` present → `claimed`
   - else window contains `today` → `pending`
   - else (previous window, no terminal event) → `expired`
4. For `pending` Occurrences with a rotation policy, compute the assignee:
   `assignee = order[count(completed events for this id) % order.length]`
5. Return the Occurrences for windows that contain `today`. `expired`
   Occurrences are computed but not rendered in v1 (D13). Occurrences older
   than the previous window never render.

### 5.3 Late and duplicate events

These are facts about the design, not edge cases to fix.

1. **Duplicate submission.** A Display retries a batch. The unique key makes
   the retry a no-op. The server reports success.
2. **Event against a retired definition.** Someone edited the Task while
   another Display had a stale view. The server accepts the event. The
   projection ignores retired ids, so the event is inert. This is correct:
   the pre-rotation in the edit flow (Section 4.3) already accounted for the
   turn.
3. **Event against a closed window.** A completion syncs after the window
   rolled over. The server accepts the event. The event advances the rotation
   count. The projection never displays it. The work counts; the calendar has
   moved on.

---

## 6. Tasks Screen

Reimplement from the design skill under `src/tasks/` (never import the kit).
Components: `MemberColumn` (without `points` and without `TimeOfDayTabs`),
`TaskRow`, the standard FAB.

- **Columns.** One equal-width column per Active Member: avatar, name,
  done/total progress for today, then one flat list of that member's
  Occurrences for today.
- **Household column.** Appended to the grid only when open, unclaimed
  Occurrences exist today (D16). Claiming from it moves the row into the
  claimant's column.
- **Ordering.** Timed rows first, ascending by `time`; untimed rows after, in
  creation order (settled in design session; timed-first).
- **Complete.** Tap the row's circle. Attribution per D15: assignee for
  `fixed`/`rotation` and claimed `open`; a member picker for unclaimed `open`.
  Complete state follows the design system (tint deepens, circle fills).
- **Skip.** A row action offering preset reasons — Away, Sick, Not needed —
  plus optional free text. Nothing is required; a skip may carry no reason.
- **Create/edit.** FAB opens the Task editor: title, type (Chore/Routine),
  recurrence, assignment, optional time. Editing an existing Task runs the
  Section 4.3 flow. Type has no visual effect in v1 (D14).
- **No points pill, no tabs, no expired rows.**

---

## 7. Acceptance Criteria

Write tests for each scenario. All references are to sections above.

### Model and projection

1. A weekly Task scheduled Monday, not completed, appears as `pending` on
   Tuesday through Sunday. It is `expired` on the next Monday and not
   rendered. (§2.3, D13)
2. Completing a Task twice in one window produces one `completed` fact. The
   second write returns success. (§2.5, inv. 1)
3. A `verified` event without a matching `completed` event is rejected.
   (§2.5, inv. 2)
4. For a rotation of [A, B, C] with 4 completions, the current assignee is B.
   (§5.2, step 4)
5. A `skipped` event does not change the rotation assignee for the next
   window. (D7)
6. A skip with no reason is valid. (§6)
7. Timed Occurrences sort before untimed ones in a member's column. (§6)

### Editing and retirement

8. Editing a Task retires the old definition and creates a new one with the
   same lineage. The old definition's `retiredAt` is set. (§4.3)
9. After an edit of a rotation Task with [A, B, C] and 1 completion, the new
   definition's order is [B, C, A], and the assignee is B. (§4.3, step 3)
10. A completion submitted against the old (retired) id after an edit is
    accepted and does not appear in the projection. (§5.3, case 2)
11. Retiring member B from a rotation [A, B, C] with 1 completion yields a
    new definition with order [C, A] and the same lineage. (§4.4)
12. Retiring a member with a fixed Task retires that definition and surfaces
    it for recreation. (§4.4)

### Sync and attribution

13. A completion submitted against a closed window is accepted, advances the
    rotation count, and does not render. (§5.3, case 3)
14. Two Displays submitting the same completion converge to one fact
    regardless of order. (§2.5, inv. 1)
15. `GET` view returns the full projection, per-member done/total counts, and
    a server timestamp. (§4.2)
16. Completing an unclaimed open Task requires a member pick; completing a
    claimed one attributes to the claimant. (D15, D16)
