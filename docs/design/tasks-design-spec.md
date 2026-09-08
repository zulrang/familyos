# Tasks — Technical Design Specification

**Status:** Approved for implementation
**Date:** 2026-08-26 (D5/D6 amended, D19 revised ADR 0007, D20 added;
supersedes `chores-design-spec.md`, 2026-08-23)
**Audience:** Implementing developer

Domain terms (Task, Chore, Routine, Occurrence, Window, Rotation, Claim, Skip,
Star, Star Balance, Stars Earned, Grant, Spend, Star Adjustment) are defined
in `CONTEXT.md`. The storage-ownership decision is recorded in
`docs/adr/0006-familyos-owned-task-store.md`. Star Balance storage is ADR 0007.

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
- Definition editing: in-place for title, type, time, and stars;
  retire-and-replace for recurrence and assignment, including the
  Household Member retirement hook
- The Tasks screen: per-member columns plus a Household column for open Tasks

### Explicitly out of scope

Considered and rejected or deferred. See the Decision Log (Section 3).

- **Verification.** The `verified` event kind and its invariant stay in the
  schema so it is additive later, but no workflow or UI ships (D10).
- **Rewards UI.** Star values, stored Star Balances, and Star Adjustments are
  baked into the domain (D19, ADR 0007), but nothing star-shaped renders in
  v1: no points pill, no Grant/Spend UI. The kit's `points` prop stays unused
  (D11).
- **Device offline queue and staleness indicator.** Displays are LAN browsers;
  if the server is down the whole app is down (D12).
- **Historical views.** The projection looks back one Window at most, and the
  wall hides `expired` occurrences entirely (D13).
- **Carryover.** A missed Task does not roll into a new Occurrence.
- **Delta sync.** The server sends the full projection on every fetch.
- **Conflict resolution logic.** The event key makes merges idempotent.
  Concurrent definition edits are last-write-wins (D20).
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
  id: TaskId                   // immutable; a new id only when recurrence or assignment changes
  lineage: LineageId           // stable across versions; used for UI grouping
  title: string
  type: TaskType
  recurrence: Recurrence
  assignment: AssignmentPolicy
  time: LocalTime | null       // optional within-day time; drives column ordering
  stars: number                // nonnegative integer earned per completion; 0 = no stars
  retiredAt: LocalDate | null  // write-once; null = active
}

type StarBalance = {
  member: MemberId
  balance: number              // nonnegative integer; source of truth; missing row = 0
}

type StarAdjustment = {        // append-only; no v1 writers (Rewards will append)
  id: string
  member: MemberId
  delta: number                // nonzero; positive = Grant, negative = Spend
  reason: string | null
  at: Instant
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

Tables:

| Table | Key | Mutability |
|---|---|---|
| `definitions` | `id` | `id`, `lineage`, `recurrence`, and `assignment` never change. `title`, `type`, `time`, and `stars` may be overwritten. `retiredAt` is set exactly once, from null to a date. |
| `events` | `(task, window, kind)` unique | Append-only. Never updated or deleted. |
| `star_balances` | `member` | Mutable nonnegative integer. Missing row is 0. |
| `star_adjustments` | `id` | Append-only. Empty in v1; Rewards appends Grants and Spends. |

Enforce the unique event key and invariant 2 as SQL constraints; enforce the
write-once `retiredAt` transition and in-place column updates in the single
writer.

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
7. `stars` is a nonnegative integer.
8. Star Balance is a nonnegative integer. A Grant or Spend of 0 is rejected.
   A Spend that would put the balance below 0 is rejected.
9. A `completed` event credits Star Balance only on `inserted`, never on
   `already-present`.

There is **no** invariant that a submitted `window` must match the current
window. See Section 5.3.

### 2.6 Star Balance (stored) and Stars Earned (derived)

**Star Balance** is a nonnegative integer keyed by Household Member. It is the
source of truth. A successful insert of `completed` adds that Task
Definition's `stars` (retired or not, closed window or not) to
`completed.by`. Retries that hit `already-present` add nothing. Both types
earn identically (D14). Cutover starts every member at 0; existing
completions are not backfilled.

An in-place star change does not rewrite stored Star Balance. Later
completions on that id credit the new value. A retire-and-replace freezes the
old row; a completion against the retired id credits that row's stars at
insert time.

**Stars Earned** is the sum of those same definition star values over
`completed` events whose `at` falls in a given Household Time Zone range, for
the Household or for one member. Skips, claims, Grants, and Spends are not
included. It is not a v1 endpoint. An in-place star change revalues this fold
because it reads the definition as it stands.

**Star Adjustment** records a Grant or Spend only. Completions are not
copied here. Adjustments are applied to the integer at write time and are
never folded on read. No v1 writers (D11).

Known ceiling, accepted: a completion recorded against both the old and the
new id of one lineage in the same window credits twice. This is the same
stale-write semantics as D5 and costs a family nothing.

---

## 3. Decision Log

These decisions are final. Each rejected alternative caused a concrete
problem. Do not reintroduce the alternatives. D1–D9 carry over from the
original chore spec; D10–D18 were settled in the 2026-08-25 design session.
D5 and D6 were amended, and D20 added, on 2026-08-26. D19 was revised
2026-08-26 (ADR 0007).

| # | Decision | Rejected alternative | Reason |
|---|---|---|---|
| D1 | Store definitions and events. Derive Occurrences as a pure projection. | Materialized occurrence rows | Materialized rows require migration on every definition edit. |
| D2 | Window semantics for missed Tasks. An Occurrence stays open until the next Window starts, then becomes `expired`. | Expire-and-recreate | Recreation stores synthetic rows that are not derivable from definitions. That breaks the pure projection. Window semantics produce the same visible result. |
| D3 | Verification is optional metadata on a completion. | A `verified` workflow state after `done` | A required verification state doubles the workflow. Completion is trust-based. |
| D4 | Rotation advances on completion only. Assignee = `order[completedCount % order.length]`. | Calendar rotation (assignee as a pure function of the date) | The family wants fairness by turns taken, not by dates elapsed. |
| D5 | Recurrence and assignment are immutable: a change retires the old row and inserts a new row with the same `lineage` and a new `id`. Title, type, time, and stars overwrite the current row. | Every field change is retire-and-replace (2026-08-25 D5); fully mutable definitions including recurrence and assignment | A new `id` is only needed when Windows or whose turn it is would change. A title change on the same `id` leaves a stale completion live and counting. |
| D6 | A retire-and-replace of a rotation copies the old `order` and pre-rotates it by the old completion count. An in-place save does not touch the fold. | Folding the rotation count across `lineage`; pre-rotating on every save | Cross-version folds require reasoning about `order` changes mid-rotation. Scoping the fold to one immutable `id` keeps it trivial. A rename must not skip a turn. |
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
| D19 | Star value on each Task Definition, captured in the editor. Star Balance is a stored nonnegative integer on the member, credited once on `completed` insert, starting at 0. Stars Earned is a derived fold over `completed.at` in an input range. Star Adjustments record Grants and Spends only, not folded, no v1 writers. (ADR 0007) | Derive Star Balance from completions plus adjustments; a Star Adjustment row per completion; absolute Set; snapshot the old fold at cutover | A spendable total must be allowed to disagree with the Task log, and historical completions must not rewrite it. Stars Earned already folds completions for a period. The `completed` event is the receipt. Grant and Spend already move the integer both ways. Nothing star-shaped renders yet, so starting at 0 loses nothing visible. |
| D20 | Concurrent definition saves are last-write-wins. No edit versions, no merge. | A retire-and-replace must read-and-merge the latest title/stars so a concurrent rename cannot be wiped | This is a fridge on the LAN, not a collaborative editor. |

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
4. If a `completed` event was `inserted`, add that definition's `stars` to
   the stored Star Balance for `by`. Do not add on `already-present`.

Response: per-event status. `inserted` and `already-present` are both success.

There are exactly two checks on this path (steps 1–2). Do not add more. In
particular, do not validate that `window` matches the current window, and do
not validate that the `task` id is active. See D5 and D9. Star Balance credit
is a write side effect, not a check.

### 4.2 `GET` view

Returns the full projection for today: an `Occurrence[]` with Task title,
type, lineage, assignee, state, and time, plus per-member done/total counts
and stored Star Balances. Include the server timestamp of the projection in
the response. Do not fold completions or Star Adjustments to produce
balances.

### 4.3 Definition editing

Creating and editing Tasks happens in the Tasks surface itself (Section 6),
not in Settings. One editor, one save. Compare the submitted recurrence and
assignment to the current definition.

If neither recurrence nor assignment changed, overwrite `title`, `type`,
`time`, and `stars` on the current row. Leave `id`, `lineage`, `recurrence`,
`assignment`, and `retiredAt` alone.

If recurrence or assignment changed, the save is one retire-and-replace
transaction. Do not mutate the old row's title, type, time, or stars.

1. Set `retiredAt = today` on the old definition.
2. Insert a new definition: same `lineage`, new `id`, submitted field values
   (including the new title, type, time, and stars).
3. If the new assignment is a rotation: copy the old `order`, rotate it left
   by `count(completed events for old id) mod order.length`, and store the
   rotated array as the new `order`.

Step 3 makes the rotation reset invisible to users. The correct person stays
on turn.

Two Displays saving the same Task: last write wins (D20).

### 4.4 Household Member retirement hook

When Settings retires a member, the server applies the Section 4.3
retire-and-replace to every active definition referencing that member, in the
same operation:

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
   the retry a no-op, including Star Balance. The server reports success.
2. **Event against a retired definition.** Someone changed recurrence or
   assignment while another Display had a stale view. The server accepts the
   event and credits Star Balance. The projection ignores retired ids, so the
   row is inert. This is correct: the pre-rotation in the retire-and-replace
   flow (Section 4.3) already accounted for the turn.
3. **Event against the same id after an in-place save.** Someone renamed the
   Task or changed its stars while another Display still showed the old
   title. The server accepts the event. The projection includes it. Same
   TaskId, still live. Star Balance credits the definition's stars at insert
   time, not a later in-place value.
4. **Event against a closed window.** A completion syncs after the window
   rolled over. The server accepts the event. The event advances the rotation
   count and credits Star Balance. The projection never displays it. The work
   counts; the calendar has moved on.

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
- **Ordering.** Remaining rows first: timed ascending by `time`, then untimed
  in creation order. Completed rows follow, in that same timed-then-untimed
  order among themselves.
- **Complete.** Tap the row's circle. Attribution per D15: assignee for
  `fixed`/`rotation` and claimed `open`; a member picker for unclaimed `open`.
  Complete state deepens the tint, fills the circle, greys the row (55%
  opacity), and moves it to the bottom of the column.
- **Skip.** A row action offering preset reasons — Away, Sick, Not needed —
  plus optional free text. Nothing is required; a skip may carry no reason.
- **Create/edit.** FAB opens the Task editor: title, type (Chore/Routine),
  recurrence, assignment, optional time, and star value (default 0). Saving
  an existing Task runs the Section 4.3 flow. Type has no visual effect in v1
  (D14), and the star value is captured but rendered nowhere (D19).
- **No points pill, no tabs, no expired rows, no star display.**

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
7. Timed Occurrences sort before untimed ones in a member's column.
   Completed Occurrences sort after remaining ones and render greyed. (§6)

### Editing and retirement

8. Changing recurrence or assignment retires the old definition and creates a
   new one with the same lineage. The old definition's `retiredAt` is set.
   (§4.3)
9. After a retire-and-replace of a rotation Task with [A, B, C] and 1
   completion, the new definition's order is [B, C, A], and the assignee is
   B. (§4.3, step 3)
10. A completion submitted against the old (retired) id after a
    retire-and-replace is accepted and does not appear in the projection.
    (§5.3, case 2)
11. Retiring member B from a rotation [A, B, C] with 1 completion yields a
    new definition with order [C, A] and the same lineage. (§4.4)
12. Retiring a member with a fixed Task retires that definition and surfaces
    it for recreation. (§4.4)

### Sync and attribution

13. A completion submitted against a closed window is accepted, advances the
    rotation count, and does not render. (§5.3, case 4)
14. Two Displays submitting the same completion converge to one fact
    regardless of order. (§2.5, inv. 1)
15. `GET` view returns the full projection, per-member done/total counts, and
    a server timestamp. (§4.2)
16. Completing an unclaimed open Task requires a member pick; completing a
    claimed one attributes to the claimant. (D15, D16)

### Stars

17. Inserting a `completed` event adds that definition's star value to the
    completing member's stored Star Balance, including retired ids and closed
    windows. An `already-present` completion does not add again. A missing
    row is 0. (§2.6, inv. 9)
18. `GET` returns stored Star Balances, not a fold of completions or Star
    Adjustments. (§2.6)
19. The editor persists a nonnegative star value; omitting it stores 0.
    (§2.5 inv. 7, §6)
20. Changing only title, type, time, or stars overwrites the current
    definition. `id`, `lineage`, and `retiredAt` are unchanged. (§4.3)
21. A completion submitted against the same id after a title-only save is
    accepted and appears in the projection. (§5.3, case 3)
22. Changing stars in place revalues existing completions on that id.
    Changing stars as part of a retire-and-replace leaves completions on the
    retired id at the old star value. (§2.6)
23. A save that changes title and assignment is one retire-and-replace. The
    new definition carries the new title. The old row's title is not mutated.
    (§4.3)
