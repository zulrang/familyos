# Tasks

Tasks is the household Family Board of FamilyOS-owned work and Bounties. It needs no Google connection. Members, assigned Tasks, and Bounties are created in parent admin (`/admin`), so a fresh data dir shows empty states.

## Sub-features

- `tasks-open` opens `/tasks` from the rail with the date heading and the `Family Board` view.
- `tasks-board` shows one column per Active Member with that member's tasks.
- `tasks-bounties` switches to the Bounties view with `Available Bounties` and a `Claim` button per offering.
- `tasks-complete` marks a task done from the wall. Unreachable without a member and an assigned task.

## How to get to it (user POV)

- Choose the `Tasks` rail link.
- Open `origin/tasks` after pairing.
- Choose the `Bounties` button in the board header, and `Family Board` to return.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Open.** Choose `Tasks`. The heading is today's date (same as Lists), with a live clock. `Family Board` heading and a button named `Bounties` are present. The body does not read `Not yet implemented`.
- **Empty board.** With no members in the data dir, the board renders no member columns. That is the expected fresh state, not a failure.
- **Bounties.** Choose `Bounties`. Heading `Available Bounties` appears, with `No Bounties available` when empty. There is no create or manage control on the wall. Choose `Family Board` to return.
- **Members and tasks.** If the run has no members, record `tasks-board` and `tasks-complete` as `verified-unreachable` with the route attempted and "no Active Members in disposable data dir". Creating members from the wall Settings `Add member` and saving makes columns appear; assigned tasks still need parent admin.
- **Proof.** Snapshot the board header with `Family Board` and `Bounties` visible, and the Bounties view. Files `tasks/board.aria.txt`, `tasks/bounties.aria.txt`.

## Gotchas

- Heading is the date, not the word Tasks. The rail label is the identity check.
- Task data lives in `FAMILYOS_DATA_DIR`, not Google. Do not copy the checkout's `data/`.
- Bounties are created only in parent admin (`/admin/bounties`). The wall must not link there.
- Parent admin at `origin/admin` needs `FAMILYOS_ADMIN_PIN`. The launch helper does not set it.
