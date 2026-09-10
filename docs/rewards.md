# Rewards

The wall's `/rewards` screen implements the approved F mockup. Select a member
on the left, choose a goal or spend on a reward on the right. Parent admin has
`/admin/rewards` for the household catalog and `/admin/stars` for Grants and
Spends, using the approved mobile E layout. The catalog starts empty; parents
create their own rewards. There is no production sample data.

## Rules

- Reward costs are positive safe integers, with no five-star limit. Up to five
  stars are pictured individually; larger amounts show the exact number with
  three horizontally overlapping stars. This is presentation, not denomination.
- Each active member may select one active Reward Goal or clear it. A Goal does
  not reserve stars. Its progress uses the member's current Star Balance and
  the reward's current price. Saving a new price updates that progress.
- Retiring a reward removes it from the available catalog and clears goals that
  reference it. Retired rewards and previous Spends remain recorded.
- A Reward Spend stores the member, reward ID/revision, original name, original
  cost, and time. Editing or retiring a reward never rewrites those details.
- A Spend is confirmed against the reward revision shown in the confirmation.
  A changed or retired reward is rejected and must be selected again. Available
  balance is checked at commit time; stale displays cannot overdraw.
- Repeat requests with the same Spend ID and same payload return the original
  receipt, even after reward changes. Reusing an ID for a different payload fails.
- Grant and Spend admin forms require a reason and preserve request IDs and
  payloads when retrying an uncertain response. Balances cannot become negative
  or exceed the safe-integer limit. Retired members remain available in admin.

## Storage and boundaries

Rewards is a separate feature slice. The two thin API routes explicitly supply
`tasksDatabase` to its handler; the rewards slice never imports tasks. Rewards
uses the existing household SQLite connection so the immutable Reward Spend and
its `star_adjustments` row commit in one `BEGIN IMMEDIATE` transaction. The
existing adjustment trigger applies the balance change. Failure at either insert
rolls back both. This avoids a second star-balance source of truth or a two-database
commit protocol. Reward tables and immutable-receipt triggers are created
idempotently after the task schema is initialized; existing task data is unchanged.

Wall API reads and choices require a paired display; mutations require a matching
Origin. Catalog changes require the existing parent-admin session, Origin, and
admin header. Responses are not cached. The wall refreshes on focus and every
15 seconds while idle, and after successful choices.

## Deferred

Rewards owed and delivery tracking are explicitly deferred to
[issue #82](https://github.com/zulrang/familyos/issues/82). Spending does not
mark a reward delivered and this release has no fulfillment UI.

## Design reference

Approved mockups are preserved on `codex/rewards-mockups` (commit `d4d58f9`),
including all variants and the final F and E decisions. They are throwaway design
references, not production routes.
