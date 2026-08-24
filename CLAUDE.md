@AGENTS.md

# FamilyOS

Test: `pnpm test` · Contract: `pnpm test:contract` · Lint: `pnpm lint`
Component tests need `// @vitest-environment jsdom` (Vitest default env is `node`).

## Entry Points
- App shell / pairing gate: `src/app/layout.tsx` (thin Next router; imports from slices)
- Calendar: `src/calendar/`
- Lists: `src/lists/`
- Settings: `src/settings/`
- Displays / pairing UI + HTTP: `src/displays/` (session/auth in `src/shared/`)
- Members: `src/members/`
- Shared UI + infra: `src/shared/` (`shared/ui/` for design-system primitives)
- Import rule: slices → `shared` (and platform `members` / household `settings`); `shared` never imports a slice; feature slices do not import each other. Display session/auth lives in `shared/` so APIs need not import `displays`.

## Do Not Touch
- The `nextjs-agent-rules` block in `AGENTS.md` (`next dev` rewrites it)
- `.cursor/skills/familyos-design/` (copy into `src/`; never import from here)
- `pnpm-lock.yaml` (change only via `pnpm`; never hand-edit)
- `docs/code-design-principles.md` (shared principles — follow them; do not edit unless explicitly told to)
- Importing `kiosk/` into the Next app

## Non-Obvious Rules
- One Server Installation = one Household and multiple paired Displays. Not phone-first or multi-tenant. Fixed 74px rail; light-only (no create-next-app dark mode or Geist).
- Google Calendar (one selected) and Google Tasks (explicitly selected tasklists) are the sources of truth — no local event/list database.
- Event Participants are stable Household Member IDs in Google private event properties only; Member Color is presentation.
- Calendar target is a rolling Five-Day View with five-day paging and contrasted weekends — do not treat the current seven-day UI as canonical.
- Unimplemented rail items (Tasks, Rewards, Meals, Recipes, Photos, Sleep) stay stubs until in scope.
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

## Agent skills

### Issue tracker

GitHub Issues on `zulrang/familyos` (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles, same strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
