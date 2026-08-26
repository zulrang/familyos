---
name: verify-familyos
description: Drive FamilyOS's Next.js wall UI in a browser to prove pairing, calendar, lists, settings, and rail stubs. Use when verifying FamilyOS user-facing changes, capturing calendar/settings/lists proof, or proving a Display pairs.
---

# Verify FamilyOS

FamilyOS is a locally hosted kitchen-wall UI. One Server Installation, one Household, several paired Displays. Google Calendar and Google Tasks are the sources of truth once signed in. Pairing, Settings household fields, the five-day calendar chrome, Lists chrome, and rail stubs work without Google.

This skill is the recipe for proving that UI the way a person uses it. Read `features/README.md` before driving. Use the matching feature file. The map lists every entry point. Driving one convenient path does not cover the others.

Secondary surfaces you do not drive here: the Pi Chromium kiosk, `kiosk/osk/`, idle-dim on hardware. Those live in `docs/kiosk.md`.

## Launch

From the repo root:

```bash
.cursor/skills/verify-familyos/scripts/verify-familyos launch
```

That command installs deps if `node_modules` is missing (`pnpm install --frozen-lockfile`), then starts `pnpm exec next dev -H 127.0.0.1 -p 4310` with `FAMILYOS_DATA_DIR` under `/tmp/familyos-verify/<run-id>/data`. It does not use `pnpm dev` (that script binds `0.0.0.0:3001` and would collide with a human's session). It does not copy `data/` from the checkout.

Ready when `GET http://127.0.0.1:4310/api/ready` returns `{"ready":true,...}` and the helper prints a doctor block. Startup also logs `FamilyOS pairing code: ……` when the disposable data dir has no Trusted Display.

Teardown:

```bash
.cursor/skills/verify-familyos/scripts/verify-familyos cleanup
```

That kills the pid the helper started and deletes the disposable data dir. Proof files under `.cursor/skills/verify-familyos/artifacts/<run-id>/` stay.

Override port with `FAMILYOS_VERIFY_PORT`. Override run id with `FAMILYOS_VERIFY_RUN`.

## Doctor

Run this before the first drive, after any failed drive, and whenever the UI looks wedged on a process that still answers:

```bash
.cursor/skills/verify-familyos/scripts/verify-familyos doctor
```

Pass only if all of these hold:

- `pid` is alive
- the listener on `PORT` is that pid or a child of it
- `data` is under `/tmp/familyos-verify/`
- `/api/ready` returns `"ready":true`
- `origin` is `http://127.0.0.1:<port>`

If the listener belongs to some other process, stop. Do not drive `localhost:3000`, `:3001`, or any instance you did not launch. Two verification instances can run side by side if they use different `FAMILYOS_VERIFY_PORT` and `FAMILYOS_VERIFY_RUN` values. They must not share a data dir.

`google_env: env-present` means `.env.local` exists. Do not read it. `google_env: no` means Calendar and Lists stay on the credentials-missing banners. `trusted_displays` counts rows in the disposable `displays.json`.

## Drive

Use the Cursor browser against `origin` from doctor. Prefer ARIA roles and accessible names.

Stable handles in this repo:

- Pairing: heading `Pair Display`, textbox `Pairing code`, button `Pair`, alert text `That code did not work.` / `That code has expired.` / `That code was already used.`
- After pair: `nav` links named `Calendar` (`/`), `Lists` (`/lists`), `Settings` (`/settings`), plus stub ids `tasks`, `rewards`, `meals`, `recipes`, `photos`, `sleep`
- Calendar: heading is the Family name (default `Family`), buttons `Schedule`, `Filter`, `Today`, `Previous five days`, `Next five days`. Unconfigured banner is either `Add Google credentials in .env.local, then sign in under Settings.` or `Sign in with Google under Settings to load the family calendar.`
- Settings: heading `Settings`, button `Save` (becomes `Saved` briefly), `Generate pairing code`, dialog titled `Pair Display`, `Family name`, `Add member`, `This Display`
- Lists: date heading, same Google banners as calendar with Lists wording
- Stubs: heading matches the rail label, body `Not yet implemented`

Pairing code for the type-in path:

```bash
.cursor/skills/verify-familyos/scripts/verify-familyos pairing-code
```

The QR path is `http://127.0.0.1:<port>/?code=<CODE>` (auto-submits once). Cookie name is `fos_display`. Do not write `data/displays.json` by hand. Do not copy the checkout's `data/` (tokens live there).

Google sign-in opens Google's account picker. Do not complete that unless the operator is present and asked you to. Calendar event create/edit and Lists item mutations need a signed-in Household with a selected calendar or selected tasklists. Those paths are `verified-unreachable` without that. Record the route you attempted and the unmet precondition.

## Evidence

Write proof under `.cursor/skills/verify-familyos/artifacts/<run-id>/` (`evidence` in the doctor block). Name files after the feature id.

A proof is complete only when it has:

- the user action (ARIA snapshot or request) and the resulting state, not only the last screenshot
- app identity visible (Pair Display, Family, Settings, or a rail label)
- a second view of any mutation (reload, or `trusted_displays` after pair, or Calendar heading after a Family name save)
- feature id and entry point in the artifact names or a `proof.txt` next to them

`GET /api/ready` and unit tests are not a UI proof. `/api/pair` is the same POST the Pairing screen makes. Using it from curl is not the user path. Type the code or open the `?code=` URL.

## Cleanup

```bash
.cursor/skills/verify-familyos/scripts/verify-familyos cleanup
```

Kills the launch pid and its children by pid, not by process name. Deletes `/tmp/familyos-verify/<run-id>/`. Leaves `.cursor/skills/verify-familyos/artifacts/`. After cleanup, confirm the artifact files still exist at that path. If a drive fails, run cleanup before the next launch so port 4310 is free.

## Helpers

All of these are `.cursor/skills/verify-familyos/scripts/verify-familyos <command>` from the repo root:

- `launch` start isolated Next, wait for `/api/ready`, print doctor
- `doctor` pid / port owner / data dir / ready
- `pairing-code` last `FamilyOS pairing code:` line from the server log
- `cleanup` stop what launch started, keep artifacts
