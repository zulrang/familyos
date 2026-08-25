# Rail stubs

Rail stubs are the v1 placeholders for screens that do not exist yet. Each one keeps the rail and header so navigation still works, and says it is not implemented.

## Sub-features

- `stub-tasks` opens `/tasks`.
- `stub-rewards` opens `/rewards`.
- `stub-meals` opens `/meals`.
- `stub-recipes` opens `/recipes`.
- `stub-photos` opens `/photos`.
- `stub-sleep` opens `/sleep`.

## How to get to it (user POV)

- Choose `Tasks`, `Rewards`, `Meals`, `Recipes`, `Photos`, or `Sleep` on the rail.
- Open `origin/<id>` for those ids after pairing.

## Driving it with the Cursor browser

Preconditions:

- Display is paired.
- `verify-familyos doctor` still reports this run's origin.

- **Each stub.** Choose the rail link. The heading matches the rail label (`Tasks`, `Rewards`, `Meals`, `Recipes`, `Photos`, `Sleep`). The body reads `Not yet implemented`. The rail remains. Choosing `Calendar` returns to `/`.
- **Unknown section.** `origin/not-a-rail` is a Next 404, not a stub. Do not treat that as this feature.
- **Proof.** One screenshot per stub is enough if the heading and `Not yet implemented` are readable. Files `rail-stubs/<id>.png`.

## Gotchas

- Calendar, Lists, and Settings are not stubs. `/calendar` redirects to `/`.
- Sleep is visually pushed to the bottom of the rail. It is still a stub, same copy.
- Do not implement these screens during a verification run. A stub that grows real UI is a product change, and the map should be updated with `/maintain-verification-skill` after that ships.
