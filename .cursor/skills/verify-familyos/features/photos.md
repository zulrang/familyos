# Photos

Photos is the Google Photos slideshow screen and the idle slideshow behind every screen. Photo selection needs Google sign-in with the Photos Picker scope. Without it the screen shows a sign-in prompt.

## Sub-features

- `photos-open` opens `/photos` from the rail with heading `Photos`.
- `photos-unconfigured` shows `Sign in to Google Photos` when the Household is not signed in.
- `photos-choose` starts a Photos Picker session and shows the selection. Unreachable without sign-in.
- `photos-sleep` the rail `Sleep` button starts the idle slideshow immediately when photos exist.

## How to get to it (user POV)

- Choose the `Photos` rail link.
- Open `origin/photos` after pairing.
- Choose `Sleep` at the bottom of the rail from any screen.
- Leave the Display untouched past the Idle Dim timeout set in Settings.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Open.** Choose `Photos`. Heading is `Photos`. The body does not read `Not yet implemented`.
- **Unconfigured.** With `google_env: no` or no sign-in, the body reads `Sign in to Google Photos` and `Sign in with Google in Settings before choosing photos.`
- **Choose.** Record `photos-choose` as `verified-unreachable` unless the operator completed Google sign-in with the Photos scope.
- **Sleep.** Choose the rail `Sleep` button. With zero photos the URL and screen do not change. Record `photos-sleep` as `verified-unreachable` with "no photos selected". With photos, a full-screen slideshow appears and any tap returns to the previous screen.
- **Proof.** Snapshot the heading and the sign-in prompt. Files `photos/open.aria.txt`.

## Gotchas

- `Sleep` is a `button` in the `nav`, not a link. There is no `/sleep` screen behind it; `origin/sleep` by URL is a leftover placeholder (see [Rail stubs](./rail-stubs.md)).
- The idle slideshow only renders when at least one photo is available. A silent no-op after `Sleep` on an empty selection is the documented behavior in `docs/photos.md`.
- Media is proxied through the server. Do not assert Google base URLs in the DOM.
