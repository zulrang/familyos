# Lists

Lists is the wall of selected Google tasklists. Without Google sign-in and selected Household Lists, the screen shows a banner and no lists.

## Sub-features

- `lists-open` opens `/lists` from the rail.
- `lists-unconfigured` shows the credentials-missing or sign-in banner.
- `lists-selected` shows only tasklists the Household selected in Settings.
- `lists-items` adds, checks, and clears items on a selected list. Unreachable without Tasks scope and a selected list.

## How to get to it (user POV)

- Choose the `Lists` rail link.
- Open `origin/lists` after pairing.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Open.** Choose `Lists`. The screen is not Pair Display. A date heading and a live clock appear once settings load.
- **Unconfigured.** With `google_env: no`, the banner is `Add Google credentials in .env.local, then sign in under Settings.` With env present but no sign-in, the banner starts with `Sign in with Google under Settings to load lists.`
- **Selected lists.** If Settings has no signed-in Google account and no Household Lists checkboxes, record `lists-selected` and `lists-items` as `verified-unreachable`.
- **Items.** When lists are present, add an item in a list's field and confirm it appears. Check it, then clear checked items if that control is shown. Confirm the item is gone on reload.
- **Proof.** Snapshot and screenshot the unconfigured banner, or the populated lists wall, as `lists/open.aria.txt` and `lists/open.png`.

## Gotchas

- Creating a list in FamilyOS creates a Google tasklist. That is not a local-only row.
- Unselecting a list in Settings hides it on the wall. It does not delete the Google tasklist.
- A 401 here can mean pairing lost or Google tokens missing. If the pairing screen returns, stop and re-pair. If the lists banner asks to sign out and back in, Tasks scope was not granted.
- Lists heading is today's date in the Household Time Zone, not the word Lists. The rail label is the identity check.
