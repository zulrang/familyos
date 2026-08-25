# Settings

Settings is the Household and Display configuration screen. A paired Display can change size and Idle Dim, mint a pairing code for another browser, edit Family name and members, and start Google sign-in when credentials exist.

## Sub-features

- `set-open` opens `/settings` with heading `Settings` and a `Save` button.
- `set-display` shows Display size, Dim after, and Dim to.
- `set-trusted` lists `This Display` and can `Generate pairing code` (dialog `Pair Display`).
- `set-household` edits Family name, Household Time Zone, members, and Save.
- `set-google` shows the OAuth setup paragraph, `Sign in with Google`, or `Signed in` / `Sign out`. Sign-in itself needs the operator.

## How to get to it (user POV)

- Choose the `Settings` rail link.
- Open `origin/settings` after pairing.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Open.** Choose `Settings`. Heading is `Settings`. Sections `Display`, `Trusted Displays`, `Google Calendar`, and `Household` are present. `Save` is present.
- **This Display.** Under Trusted Displays, a row reads `This Display`. `Revoke` is present. Do not revoke the current Display unless the feature under test is returning to the pairing gate.
- **Mint code.** Choose `Generate pairing code`. A dialog named `Pair Display` shows a six-character code and `Pairing QR code`. Close with `Close`.
- **Family name.** Change `Family name` to `VerifyHousehold`. Choose `Save`. The button reads `Saved`. Choose `Calendar`. The heading is `VerifyHousehold`. Choose Settings and restore `Family`, then Save, if the instance will be reused.
- **Google.** If `google_env: no`, the Google Calendar section tells the reader to put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`. If env is present and nobody has signed in, `Sign in with Google` is present. Completing Google's picker is `verified-unreachable` unless the operator does it.
- **Proof.** Snapshot Settings with `This Display` visible, plus Calendar after the Family name save. Files `settings/open.aria.txt`, `settings/renamed-calendar.png`.

## Gotchas

- Save writes Household fields, Display size, and Idle Dim in one control. A failed household write still may have applied Display size.
- `Generate pairing code` requires an already-trusted Display. The startup log code is a different mint, used only when no Trusted Display exists yet.
- Member Color inputs are labeled `Member Color for <name>`. Duplicate active colors show `Each Active Member needs a different Member Color.`
- At most six Active Members. `Add member` disables at the cap.
- Revoking This Display returns that browser to Pair Display immediately.
