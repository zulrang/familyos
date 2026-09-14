---
status: accepted
---

# Bounty availability is separate from scheduled work

Bounties are Chores available to claim, with no scheduled work date until an
Active Member reserves one; claiming schedules it for today in the Household
Time Zone. Once offerings persist until claimed, and claimed work persists
until completed or released. Recurring offerings follow fixed calendar
intervals with a starting date: the next interval replaces an unclaimed
offering and creates a new offering even when earlier claimed work remains
unfinished.

This separates offering availability from the lifetime of the claimed work,
rather than expiring both at the same Window boundary or delaying recurrence
until completion. Multiple outstanding claims from different intervals are
therefore possible. This revises the Bounty portions of D2 and the Window rules
in the task design spec; assigned Tasks retain their Window semantics.

Claims reserve work rather than providing advisory attribution. Releasing a
claim from an earlier recurring interval ends that commitment without adding
another offering alongside the current interval's work. Retiring a member
automatically releases their unfinished claims using the same release rules.
Bounties cannot be skipped; claims may be released and unwanted Bounties retired.

Bounties display their existing Star reward for completion, not a separate
difficulty rating. The reward is captured at Claim and preserved through later
definition edits, rather than using the definition's value at completion as
other Tasks do (a Bounty-specific revision to ADR 0007). This keeps completion
credit consistent with the reward the member accepted.

Available offerings appear in a dedicated Bounties view, while claimed work
appears with its member. Existing open Routines become Chores/Bounties while
preserving their history.

Each Claim preserves the accepted description as well as the Star reward.
Retiring a Bounty stops offerings but preserves unfinished claims; releasing
one of those claims ends it without reopening retired work. Otherwise a Once
offering or an offering in its current recurring interval reopens on Release,
and a new Claim captures a new scheduled date, description, and reward.
The same member may hold claims from multiple intervals of one Bounty.

Administrative Undo reverses the Star credit and reopens the original Bounty
claim, preserving its accepted work and reward. Unlike the existing terminal
correction behavior, Bounty work can then be completed again; completion
identity must therefore distinguish a new completion from a retry while
preserving the earlier completion and correction history.

Undo is atomic and rejected if reversing credit would make Star Balance
negative. A retired claimant's reopened work follows normal Release rules.
Restore is permitted only while the original reopened claim remains unfinished
and unreleased; subsequent release, reclaim, or completion invalidates it.
Migration applies reopening to previously undone Bounty completions too,
without reversing their credit a second time.
