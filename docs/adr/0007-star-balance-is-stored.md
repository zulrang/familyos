# Star Balance is stored on the member; Stars Earned is derived

Star Balance is a spendable total a parent can Grant and Spend, so it cannot
be a fold over completions: that fold cannot disagree with the Task log, and
historical completions must not rewrite the current total. It is a nonnegative
integer keyed by Household Member, stored in the FamilyOS-owned SQLite store
(ADR 0006), credited once when a `completed` event is inserted, starting at 0
with no backfill. Stars Earned is a separate fold of Task star values over
completions whose time falls in an input Household Time Zone range, for the
Household or one member.

This reverses the 2026-08-25 D19 derived-balance rule. Completions are not
copied into Star Adjustments. Grant and Spend are nonzero deltas recorded as
Star Adjustments and applied to the integer at write time; they are not folded
on read. No Grant/Spend writers ship until Rewards (D11).

## Considered Options

- **Keep deriving Star Balance, add only Stars Earned** — rejected. The period
  fold does not need a stored total, but a parent-settable spendable total
  does. Drift from the completion log is the point.
- **Absolute Set** — rejected. Grant and Spend already move the integer in
  both directions.
- **A Star Adjustment row per completion** — rejected. The `completed` event
  is the receipt; duplicating it is what D1/D19 were guarding.
- **Snapshot today's derived fold at cutover** — rejected. Nothing
  star-shaped renders yet, so starting at 0 loses nothing visible.

## Consequences

- `GET` star balances read the stored integer, not a projection over events.
- A successful `completed` insert increments the integer; `already-present`
  does not.
- Household Configuration does not hold Star Balance. The roster JSON is the
  wrong place for a value that changes on every completion.
- Tasks may credit the integer. Grant/Spend UX stays out of Tasks.
