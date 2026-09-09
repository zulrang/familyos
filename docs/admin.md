# Parent admin

Open `/admin` on an iPhone connected to the household Wi-Fi. It has its own
mobile layout and does not require display pairing. It has no link in the wall
navigation. Existing paired displays keep their existing permissions.

Set `FAMILYOS_ADMIN_PIN` to exactly six digits in the server's environment or
`.env.local`, then restart the server. Keep the value server-side; do not use a
`NEXT_PUBLIC_` variable. If unset or malformed, admin access is disabled.
Changing the PIN invalidates existing admin sessions. The PIN cannot be changed
from the browser.

The interface uses the existing HTTP server. In Safari, use **Share → Add to
Home Screen** and open it as a web app. The manifest, standalone metadata, and
iPhone icons are scoped to `/admin`. Editing requires a connection; there is no
service worker, offline data cache, or queued editing. The wall retains its own
layout, pairing, scaling, and dimming.

## Access

- Sessions use random, HttpOnly, SameSite=Strict cookies. The server stores only
  credential hashes in `admin.sqlite` under `FAMILYOS_DATA_DIR` (default `data/`).
- Every admin data request checks session expiry on the server. Reading data
  does not renew a session. Foreground interaction renews it, at most once per
  ten seconds. Fifteen minutes without activity locks access; **Lock now** also
  revokes the server session. The browser clears protected screens on expiry
  and checks access when returning from the background.
- Five failed attempts on a device start a five-minute cooldown. Fifty failed
  attempts across devices in five minutes start a server-wide five-minute
  cooldown. Attempts and cooldowns survive server restarts.
- Mutations require a matching Origin and an admin request header. Paired
  display credentials do not authorize admin endpoints. API responses use
  `Cache-Control: no-store`.

## Editing local data

**Tasks:** create, edit, and retire; manage once/daily/weekly/monthly schedules,
fixed/open/rotation assignments, type, optional time, and star value. Title,
type, time, and stars edit in place. Schedule or assignment changes atomically
retire the old definition and create one with the same lineage. Rotations
preserve the next surviving person's turn. Retired definitions remain visible
under “Include retired tasks and old versions.” Editing a replaced definition
requires refreshing; a stale phone cannot revive an old version.

**Members:** create and edit names/colors, or retire. IDs remain stable and
retirement preserves history. The existing six-active-member and unique-color
rules apply. Retiring a member retires fixed tasks and removes them from
rotations (retiring an empty rotation). The roster is written atomically with
serialized version checks. Task reconciliation runs after saving the roster and
before task reads, so interruption between the JSON and SQLite writes recovers
on the next read without creating duplicate replacements.

**Completion corrections:** record a reason to undo, restore, or reattribute an
existing completion. Original events stay immutable. An append-only correction
overrides the completion in the current projection and reverses/transfers the
stars credited at the original completion. Undo appears as skipped on the wall,
since its immutable completion receipt cannot be inserted a second time; parents
can restore it from admin. A stale correction is rejected. Corrections to retired
task versions do not rewrite the rotation of their replacement.

**Stars:** view active and retired members' balances and record a nonzero Grant
or Spend with a reason. The balance cannot become negative or exceed the safe
integer limit. Retries with the same adjustment/correction ID do not apply twice.
If a completion's stars have already been spent, reversing it requires enough
balance first; no partial correction is saved. Adjustment history and completion
history remain separate.

## Task storage migration

The first task-store open upgrades SQLite to version 2 transactionally. Following
ADR 0007, stored balances start at zero without backfilling old completions or
adjustments. Original definitions and events remain intact. New completions
credit their stored star value exactly once, including late events for retired
definitions. Changing a task's star value does not revalue existing balances.
Legacy completions have no stored credit to reverse when corrected.

Calendar, Google lists, photos, system settings, and rewards management are not
part of this admin release.
