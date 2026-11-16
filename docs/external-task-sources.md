# External Task Sources

An External Task Source sends FamilyOS tasks from another app. Each one becomes
an assigned Chore, due once, that shows up on the wall like any other Task.
FamilyOS pulls the work; nothing outside can push to it. Derupt is the only
source today. The design and its trade-offs are in
[ADR 0013](adr/0013-external-task-sources.md).

## Set up Derupt

1. In Derupt, open **Settings → Connections → Add**, name the connection (for
   example “FamilyOS”), and turn on the **Task** kind only. Copy the token
   Derupt shows once.
2. On the FamilyOS server, add it to `.env.local` (or the server environment):

   ```text
   FAMILYOS_DERUPT_TOKEN=<the connection token>
   ```

3. Restart FamilyOS (on the household Mac, `./scripts/macos-server restart`;
   release worktrees share the checkout's `.env.local`).
4. In parent admin, open **Task sources** and choose the **Default member**:
   the person who gets tasks that don't name anyone.

Treat the token as a password. FamilyOS sends it only over HTTPS. Without the
variable the source is off and FamilyOS makes no requests. Every server process
that has the token polls, so keep it out of development checkouts.

`FAMILYOS_DERUPT_ENDPOINT` overrides the processor URL for tests or a local
Derupt stack. It must be HTTPS, or HTTP to `localhost`/`127.0.0.1`.

## What a hand-off becomes

| Hand-off | Task |
| --- | --- |
| Text | Title, with whitespace collapsed. Notes and details follow after “ — ”. Titles longer than 500 characters end in “…”. |
| `member` attribute | Assignee: an Active Member's name (any case) or member ID. Without it, the default member. |
| `date` attribute | The day it is due, `YYYY-MM-DD`. Without it, today in the Household Time Zone. |
| `time` attribute | Preferred time, `HH:mm` (24-hour). Without it, none. |
| `stars` attribute | Star reward, a whole number. Without it, 0. |
| Other attributes | Ignored. |

Attribute names match in any case (`Member`, `member`). Two spellings that
disagree, such as `member: Dad` and `Member: Ellie`, are refused. Tasks are
always Chores with a fixed assignee and recurrence Once.

## When a hand-off fails

A hand-off FamilyOS can't use is reported to Derupt as failed and shows there.
Fix it in Derupt and retry. Codes:

| Code | Meaning |
| --- | --- |
| `kind_not_accepted` | Not a Task (Idea, Research or Purchase). |
| `unknown_member` | `member` names nobody, or a retired member. |
| `ambiguous_member` | Two Active Members share that name; use the member ID. |
| `no_default_member` | No `member`, and no default member, or the default has retired. |
| `conflicting_attributes` | Differently-cased copies of one attribute disagree. |
| `invalid_date`, `invalid_time`, `invalid_stars` | That attribute isn't in the format above. |
| `empty_task` | The hand-off has no words. |
| `invalid_hand_off` | Derupt sent something FamilyOS couldn't read. |
| `intake_unavailable` | FamilyOS couldn't save the Task; Derupt retries it. |

Each hand-off creates at most one Task, even if Derupt delivers it again. If you
withdraw a hand-off in Derupt after FamilyOS took it, the Task stays; retire it
in admin.

## Status

**Admin → Task sources** shows whether each source is on, when it last checked
successfully, and the last problem code. FamilyOS checks about once a minute
and waits longer (up to 15 minutes) while the source is unreachable.

If Derupt rejects the token or the connection is removed, polling stops and the
page says so. Create a new token or connection, update
`FAMILYOS_DERUPT_TOKEN`, and restart FamilyOS.

FamilyOS stores the Task, not the hand-off; the Task's title is the only copy of
the text. Logs record work IDs and codes, never what was written.

## Development

The slice is `src/external-task-sources/`: `intake.ts` (pure planning rules),
`intake-store.ts` (once-only Task creation), `derupt.ts` (protocol),
`poller.ts` (claim loop and scheduling), and the admin page. Tests run the
poller against a fake Derupt server (`derupt-fake.test-support.ts`) with a
temporary household; `derupt.contract.test.ts` pins the protocol to the
messages recorded in Derupt's destination guide.

Reverting this feature stops intake. Tasks already created remain, and the
receipt table and default-member setting are left unused.
