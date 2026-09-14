# Rewards

Rewards is the wall screen where a member picks a goal or spends stars. The reward catalog and Star Balances come from parent admin, so a fresh data dir shows an empty state.

## Sub-features

- `rewards-open` opens `/rewards` from the rail with heading `Rewards`.
- `rewards-empty` shows the no-members message when the Household has no Active Members.
- `rewards-members` lists members with goal progress once members exist.
- `rewards-spend` chooses a goal or confirms a Spend. Unreachable without members, rewards, and stars from parent admin.

## How to get to it (user POV)

- Choose the `Rewards` rail link.
- Open `origin/rewards` after pairing.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Open.** Choose `Rewards`. Heading is `Rewards` with the tagline `Small efforts. Happy moments.` The Family name appears under it. The body does not read `Not yet implemented`.
- **Empty.** With no members, the body reads `Add a household member in parent admin to use Rewards.`
- **Members.** After adding members in wall Settings, the `Member goal progress` aside lists them with `Select a member to choose a reward.` Choosing one shows `Rewards for <name>`. With an empty catalog the body reads `Add rewards in parent admin to start collecting.`
- **Spend.** Record `rewards-spend` as `verified-unreachable` unless parent admin has created rewards and granted stars.
- **Proof.** Snapshot the heading and whichever state was reached. Files `rewards/open.aria.txt`.

## Gotchas

- The catalog starts empty by design. There is no sample data.
- Star Balances and Spends are recorded server-side. A Spend during verification is a real mutation in the disposable data dir.
- See `docs/rewards.md` for the rules a confirmation must obey.
