# FamilyOS verification map

This directory is the maintained source for verifying the user-facing behavior of FamilyOS. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-familyos/scripts/verify-familyos launch`.
- Doctor must report `origin: http://127.0.0.1:4310` (or the `FAMILYOS_VERIFY_PORT` you set), `data` under `/tmp/familyos-verify/`, and `ready: true`.
- Start unpaired (`trusted_displays: 0`) unless a feature file says otherwise.
- Drive only the instance that doctor accepted. Never `localhost:3000` unless that is the origin doctor printed.
- Google Calendar and Google Tasks mutations need `.env.local` plus an operator-completed Google sign-in. Without that, mark those sub-features `verified-unreachable`.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or coordinates.
- Treat every command as literal.
- Browser work uses the Cursor browser against `origin`.
- Process control uses `verify-familyos` only.
- Restore household fields you change if the run will keep the instance. Disposable data dirs go away on cleanup. Proof files do not.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with FamilyOS identity visible.
- Mutation proof includes a second user-facing view or `trusted_displays` from doctor.
- Record the feature ID and entry point with every artifact.
- An unreachable path (Google sign-in, selected calendar, selected tasklist) is `verified-unreachable` with the route attempted and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the Cursor browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Pair Display](./pair-display.md) covers the pairing gate, typed code, QR URL, and failed codes.
- [Calendar](./calendar.md) covers the five-day view, chrome, unconfigured banners, and Google-backed events.
- [Settings](./settings.md) covers Display, Trusted Displays, Household fields, and Google connection.
- [Lists](./lists.md) covers the Lists wall, unconfigured banners, and Google-backed list mutations.
- [Rail stubs](./rail-stubs.md) covers Tasks, Rewards, Meals, Recipes, Photos, and Sleep placeholders.
