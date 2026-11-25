---
status: accepted
---

# External Task Sources pull work into assigned Tasks

FamilyOS can receive Tasks that people hand off from another app. The first
such app is Derupt: a person captures “take out the recycling”, hands it to
their FamilyOS connection, and it appears on the wall as an assigned Chore.

## Decision

An **External Task Source** is a source-neutral intake. An adapter speaks one
source's protocol and translates each item into an `ExternalTaskRequest`
(stable ID, text, optional notes and details, name/value attributes). The
intake plans one assigned Chore from it with plain rules and no model:

- due once, on the `date` attribute or today in the Household Time Zone;
- assigned to the `member` attribute (Active Member name, case-insensitive, or
  exact ID), or else to the household's default member;
- optional `time` (`HH:mm`) and `stars`; other attributes are ignored;
- titled with the text, notes and details joined by “ — ”, cut to 500
  characters.

A request that cannot be planned is refused with a stable code
(`unknown_member`, `no_default_member`, `invalid_date`, …) and never retried:
the sender sees it as failed and fixes it there. The Tasks slice's existing
draft parser decides what a valid assigned Task is.

The code is the composing slice `src/external-task-sources/` (ADR 0011's rule:
it may import Tasks; nothing imports it). It runs inside the server process,
started from `src/instrumentation.ts`, one poller per process, and is
idle while no token is configured. The token is saved by a parent in admin
(server-side, owner-only file) or, failing that, read from
`FAMILYOS_DERUPT_TOKEN`; the saved one wins. The poller re-reads it on each
poll and is woken when a parent saves or clears it, so changes need no
restart.

**Pull, not push.** Derupt never calls a destination; FamilyOS claims work
about once a minute until Derupt reports none, backing off on network and
server errors. The wall server needs no inbound exposure.

**Exactly one Task per request.** Delivery is at least once. The table
`external_task_requests` (source, request ID → Task) commits in the same
transaction as the Task definition, and a request with a receipt is
acknowledged without planning it again. A crash between creating the Task and
acknowledging it therefore cannot duplicate the Task, even if the household
changed in between.

**Default member is Household Configuration.** It is stored by stable member ID
in `household.json` with the other shared settings and chosen in parent admin.
Retiring that member does not change it; intake then refuses requests without a
member (`no_default_member`) and admin asks for a new choice.

**Stops leave Tasks alone.** When the sender withdraws a hand-off, FamilyOS
confirms the cancellation. A Task already created stays; parents can retire it
in admin. Deleting household data on a remote signal was judged riskier than a
stray Task.

**Halting is explicit.** A rejected token (401) or a removed connection stops
polling until restart, since replacing the token needs a restart anyway. Status
(enabled, last successful check, last problem code, halted) lives in memory and
is shown in admin. It never includes request text, and logs carry only work IDs
and codes.

## Alternatives considered

- **Reuse the MCP endpoint with an external agent relaying hand-offs.** It
  needs a second always-on process and puts a model or script between the
  sender and the store. Pulling in-process is simpler and deterministic.
- **Reuse `agent_task_writes` receipts with a derived UUID.** Those receipts
  reject a replay whose payload differs; a redelivery planned on another day or
  after a default-member change would be refused instead of acknowledged.
- **A separate poller process (cron or LaunchAgent).** One more service to
  install, monitor and keep in step with releases; the server already runs
  whenever the wall works.
- **Persisting status.** Halted state must clear on restart, and the other
  fields are diagnostic; a database row would add a write per minute for no
  user benefit.

## Consequences

- A second source adds an adapter beside `derupt.ts` and its own status entry;
  the intake, receipts and admin default are shared.
- Every server process with the token polls. Do not put the production token in
  a development checkout's `.env.local`, or hand-offs land in development data.
- Reverting removes intake and the admin page. The additive
  `external_task_requests` table and the `externalTaskDefaultMember` field stay
  and are ignored; Tasks already created remain ordinary Tasks.

See [External Task Sources](../external-task-sources.md) for setup.
