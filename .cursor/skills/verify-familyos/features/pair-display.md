# Pair Display

Pair Display is the gate on an unpaired browser. A person types the short-lived server code or opens the QR URL, then the Household chrome (rail plus Calendar) appears and stays on reload.

## Sub-features

- `pair-screen` shows only pairing UI on `/` when the browser has no Display cookie.
- `pair-type` accepts the startup code through the Pairing code field and Pair.
- `pair-qr` pairs by opening `/?code=<CODE>` (same secret, auto-submit).
- `pair-persist` still shows Calendar after a reload, not the pairing screen.
- `pair-reject` shows an alert for a wrong, expired, or already-used code.

## How to get to it (user POV)

- Open `origin/` in a browser with no `fos_display` cookie.
- Type the code printed as `FamilyOS pairing code: ……` in the server log, then choose Pair.
- Open `origin/?code=<CODE>` (the QR target from the server log or Settings pairing dialog).
- Press Enter in the Pairing code field instead of choosing Pair.

## Driving it with the Cursor browser

Preconditions:

- `verify-familyos doctor` reports `ready: true` and `trusted_displays: 0`.
- `verify-familyos pairing-code` prints a live six-character code.
- The browser has no leftover FamilyOS cookie for this origin.

- **Open gate.** Navigate to `origin/`. The heading is `Pair Display`. A textbox named `Pairing code` and a button named `Pair` are present. There is no `Calendar` nav link.
- **Type code.** Fill `Pairing code` with the code from `pairing-code` (uppercase, no spaces). Choose `Pair`. The page navigates to `/`. A `nav` link named `Calendar` is present. The heading is `Family`. Doctor now reports `trusted_displays: 1`.
- **Persist.** Reload `origin/`. The pairing screen does not return. Calendar chrome is still there (`Schedule`, `Today`).
- **QR entry (fresh unpaired browser).** Cleanup is not required if you mint a new code from Settings after the first pair. For a cold start, launch a new run, then navigate to `origin/?code=<CODE>` instead of typing. The same Calendar chrome appears. Do not count this as done if you only typed the code.
- **Reject.** On a fresh unpaired load, fill `Pairing code` with `XXXXXX` and choose `Pair`. An alert reads `That code did not work.` The heading stays `Pair Display`.
- **Proof.** Save `artifacts/<run-id>/pair-display/before.aria.txt` on the unpaired screen, `after.aria.txt` and `after.png` on Calendar, and a doctor dump showing `trusted_displays: 1`.

## Gotchas

- The code expires after 10 minutes and is one-use. Grab it from the log immediately before typing.
- `/?code=` auto-pairs once per sessionStorage key. A second load of the same URL will not POST again.
- Pairing with curl to `POST /api/pair` is not this feature's user path.
- A cookie from a previous run on the same origin will skip the gate. Use the isolated port, or a clean browser profile.
- `pnpm dev` on port 3000 is a different instance. Doctor origin is the only URL that counts.
