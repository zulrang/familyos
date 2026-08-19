@AGENTS.md

# FamilyOS

## Entry Points
- App shell: `src/app/layout.tsx`
- Product spec: `docs/requirements.md`
- Calendar UI: `src/components/calendar/`
- Lists UI: `src/components/lists/`
- Architecture: `docs/SSD.md`
- Wall Pi / touch / OSK: `docs/kiosk.md`
- This machine’s kiosk runbook: `docs/kiosk.local.md` (gitignored)
- Design system: `.cursor/skills/familyos-design/SKILL.md`

## Do Not Touch
- The `nextjs-agent-rules` block in `AGENTS.md` (`next dev` rewrites it)
- `.cursor/skills/familyos-design/` (copy into `src/`; never import from here)
- `pnpm-lock.yaml`

## Non-Obvious Rules
- Wall kiosk for one household, not a phone-first or multi-tenant app. The 74px rail never collapses. Light-only — do not keep create-next-app dark mode or Geist fonts.
- Calendar reads/writes go to the Google Calendar selected in Settings. Do not add a local event database as source of truth. Household members are identified by event color (`colorId`), not by requiring each person to have an email attendee.
- Lists reads/writes go to Google Tasks (each panel is a tasklist). Do not add a local list database as source of truth.
- Unimplemented rail items (Tasks, Rewards, Meals, Recipes, Photos, Sleep) stay "not yet implemented" stubs until those screens are in scope.
- Reimplement UI in `src/` from the design skill; the skill kit uses `window.DS` and CDN icons and will not run as Next modules.
- Kiosk typing is the Chromium extension in `kiosk/osk/`, not a React overlay and not Onboard. Do not import `kiosk/` into the Next app.

## Key Documents
- For architecture and constraints, see `docs/SSD.md`
- For visual language and component contracts, see `.cursor/skills/familyos-design/readme.md`
- For v1 scope, see `docs/requirements.md`
- For FullPageOS (touch, cursor, keyboard) and the reference hardware stack, see `docs/kiosk.md`
- For this machine’s host URL, DDC bus, and applied workarounds, see `docs/kiosk.local.md` (gitignored)
