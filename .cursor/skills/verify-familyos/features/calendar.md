# Calendar

Calendar is the home screen after pairing. It shows a rolling five-day grid for the Household Time Zone, member chips, and paging. Events load from the selected Google Calendar after sign-in.

## Sub-features

- `cal-home` opens `/` as Calendar with heading equal to Family name (default `Family`).
- `cal-chrome` shows `Schedule`, `Filter`, `Today`, `Previous five days`, and `Next five days`.
- `cal-unconfigured` shows the credentials-missing or sign-in banner when Google is not ready.
- `cal-page` moves the five-day window with previous/next and returns with Today.
- `cal-events` loads and creates events against Google. Unreachable without sign-in and a selected family calendar.

## How to get to it (user POV)

- After pairing, land on `/`.
- Choose the `Calendar` rail link from any other screen.
- Choose `Previous five days`, `Next five days`, or `Today`.
- Choose the `Add` FAB when signed in with a family calendar selected (opens the event sheet).

## Driving it with the Cursor browser

Preconditions:

- Display is paired (`trusted_displays` ≥ 1).
- `verify-familyos doctor` still reports this run's origin.

- **Home.** Navigate to `origin/` or choose `Calendar`. Heading is `Family` (or the saved Family name). Buttons `Schedule`, `Filter`, and `Today` are present. `Previous five days` and `Next five days` are present.
- **Unconfigured.** With `google_env: no`, the banner is `Add Google credentials in .env.local, then sign in under Settings.` With env present but no sign-in, the banner is `Sign in with Google under Settings to load the family calendar.` The `Add` FAB is absent.
- **Page.** Choose `Next five days`. Weekday labels change. Choose `Today`. The current day returns (today's date uses a coral badge).
- **Events.** If Settings does not show `Signed in` and a selected Family calendar, record `cal-events` as `verified-unreachable`. Do not copy tokens from another data dir.
- **Proof.** Snapshot and screenshot the five-day chrome plus the banner. Include weekday labels. Name files `calendar/home.aria.txt` and `calendar/home.png`.

## Gotchas

- Heading is the Family name, not the word Calendar. After a Settings rename, assert the new name here.
- Filter hides member chips. It does not change Google data. Turn it back on before asserting chips.
- `Schedule` only scrolls the time grid. It is not a view switch.
- README's `docs/calendar.png` is an old seven-day capture. The running UI is five days (`DAY_COUNT = 5`).
- Creating an event titled empty saves as `Busy`. Assert the rendered title.
