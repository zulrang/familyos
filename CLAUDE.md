@AGENTS.md

# FamilyOS

Test: `pnpm test` · Contract: `pnpm test:contract` · Lint: `pnpm lint` (Biome + slice import boundaries)
Component tests need `// @vitest-environment jsdom` (Vitest default env is `node`).

## Entry Points
- Wall shell / pairing gate: `src/app/(display)/layout.tsx` (thin Next router; imports from slices)
- Parent admin: `src/app/admin/layout.tsx` → `src/admin/AdminShell.tsx` (PIN session; pages compose slice `Admin*` components)
- Calendar: `src/calendar/`
- Lists: `src/lists/`
- Tasks (incl. Bounties, Star Balances): `src/tasks/`
- Rewards: `src/rewards/`
- Photos: `src/photos/`
- Settings: `src/settings/`
- Displays / pairing UI + HTTP: `src/displays/` (session/auth in `src/shared/`)
- Members: `src/members/`
- Shared UI + infra: `src/shared/` (`shared/ui/` for design-system primitives)
- Import rule: slices → `shared` (and platform `members` / household `settings`); `shared` never imports a slice; feature slices do not import each other. Display session/auth lives in `shared/` so APIs need not import `displays`. Enforced by `scripts/import-boundaries.ts`.

## Do Not Touch
- The `nextjs-agent-rules` block in `AGENTS.md` (`next dev` rewrites it)
- `.cursor/skills/familyos-design/` (copy into `src/`; never import from here)
- `pnpm-lock.yaml` (change only via `pnpm`; never hand-edit)
- `docs/code-design-principles.md` (shared principles — follow them; do not edit unless explicitly told to)
- Importing `kiosk/` into the Next app

## Non-Obvious Rules
- One Server Installation = one Household and multiple paired Displays. Not phone-first or multi-tenant. Fixed 74px rail; light-only (no create-next-app dark mode or Geist).
- The primary device is a wall touchscreen kiosk used by all ages, including children. Every interaction should be easy, pleasant, delightful — Guiding Principles in `docs/SSD.md`.
- Production (`pnpm start`) is port 3000; development (`pnpm dev`) is 3001 so both can run. On the household Mac, a LaunchAgent (`scripts/macos-server`) KeepAlives `:3000`; refresh with `./scripts/macos-server update`.
- Google Calendar (one selected) backs Calendar and Google Tasks (explicitly selected tasklists) backs Lists — no local event/list database. Tasks, Bounties, Star Balances, and Rewards are FamilyOS-owned in `node:sqlite` (ADR 0006), never Google Tasks.
- Event Participants are stable Household Member IDs in Google private event properties only; Member Color is presentation.
- Calendar is a rolling Five-Day View with five-day paging and contrasted weekends. `docs/calendar.png` is an older seven-day capture.
- Unimplemented rail items (Meals, Recipes) stay stubs until in scope. Sleep is a rail action that starts the idle slideshow (`docs/photos.md`), not a screen. Tasks follows `docs/design/tasks-design-spec.md` with Bounties per `docs/design/bounties-design-spec.md`; Rewards follows `docs/rewards.md`; parent admin follows `docs/admin.md`; Photos follows `docs/photos.md`.
- Reimplement UI in `src/` from the design skill; the kit uses `window.DS` / CDN icons and will not run as Next modules.
- Kiosk typing is the Chromium extension in `kiosk/osk/`, not a React overlay and not Onboard.
- When changing, authoring, or reviewing code, follow `docs/code-design-principles.md`.

## Key Documents
- Domain terms: `CONTEXT.md`
- Architecture and traps: `docs/SSD.md`
- Code design: `docs/code-design-principles.md`
- v1 scope: `docs/requirements.md`
- Design contracts: `.cursor/skills/familyos-design/readme.md`
- Wall Pi / OSK: `docs/kiosk.md` · machine-local: `docs/kiosk.local.md` (gitignored)
- Decision records: `docs/adr/`
- Mobile browser previews or access from a remote PC: `docs/agents/mobile-preview.md`

## Agent skills

### Issue tracker

GitHub Issues on `zulrang/familyos` (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles, same strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
