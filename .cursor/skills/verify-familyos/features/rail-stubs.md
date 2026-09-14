# Rail stubs

Rail stubs are the placeholders for screens that do not exist yet. Each one keeps the rail and header so navigation still works, and says it is not implemented. Only Meals and Recipes are still stubs on the rail. Tasks, Rewards, and Photos are real screens with their own feature files. Sleep is a rail action, not a screen.

## Sub-features

- `stub-meals` opens `/meals`.
- `stub-recipes` opens `/recipes`.
- `stub-sleep-url` opens `/sleep` by URL only. The rail's `Sleep` button does not go here; it starts the idle slideshow (see [Photos](./photos.md)).
- `stub-unknown` confirms an unknown section is a 404, not a stub.

## How to get to it (user POV)

- Choose `Meals` or `Recipes` on the rail.
- Open `origin/meals`, `origin/recipes`, or `origin/sleep` after pairing.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Each stub.** Choose the rail link. The heading matches the rail label (`Meals`, `Recipes`). The body reads `Not yet implemented`. The rail remains. Choosing `Calendar` returns to `/`.
- **Sleep by URL.** Navigate to `origin/sleep`. Heading `Sleep`, body `Not yet implemented`. This is the only way to reach that placeholder.
- **Unknown section.** `origin/not-a-rail` is a Next 404, not a stub. Do not treat that as this feature.
- **Proof.** One screenshot per stub is enough if the heading and `Not yet implemented` are readable. Files `rail-stubs/<id>.png`.

## Gotchas

- Calendar, Lists, Tasks, Rewards, Photos, and Settings are not stubs. `/calendar` redirects to `/`.
- The rail's `Sleep` item is a `button`, not a link. Pressing it puts the Display into idle mode. With zero selected photos nothing visible changes, which is expected.
- Do not implement these screens during a verification run. A stub that grows real UI is a product change, and the map should be updated with `/maintain-verification-skill` after that ships.
