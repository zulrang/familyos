@AGENTS.md

# FamilyOS

## Entry Points
- App shell: `src/app/layout.tsx`
- Domain language: `CONTEXT.md`
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
- One local Server Installation serves one Household and multiple paired Displays. It is not phone-first or multi-tenant. The 74px rail never collapses. Light-only — do not keep create-next-app dark mode or Geist fonts.
- Calendar reads/writes go to the one Google Calendar selected in Settings. Do not add a local event database as source of truth. Stable Household Member IDs in Google private event properties are the only participant identity; colors are presentation only.
- The Calendar is a rolling five-day view with five-day paging and visibly contrasted weekend columns.
- Lists reads/writes go to explicitly selected Google tasklists. Do not expose every tasklist on the connected account or add a local list database as source of truth.
- Unimplemented rail items (Tasks, Rewards, Meals, Recipes, Photos, Sleep) stay "not yet implemented" stubs until those screens are in scope.
- Reimplement UI in `src/` from the design skill; the skill kit uses `window.DS` and CDN icons and will not run as Next modules.
- Kiosk typing is the Chromium extension in `kiosk/osk/`, not a React overlay and not Onboard. Do not import `kiosk/` into the Next app.
- When changing, authoring, or reviewing code, follow `docs/code-design-principles.md`.

## Key Documents
- For canonical domain terms, see `CONTEXT.md`
- For code design standards, see `docs/code-design-principles.md`. Apply whenever code is changed, authored, or reviewed.
- For architecture and constraints, see `docs/SSD.md`
- For visual language and component contracts, see `.cursor/skills/familyos-design/readme.md`
- For v1 scope, see `docs/requirements.md`
- For FullPageOS (touch, cursor, keyboard) and the reference hardware stack, see `docs/kiosk.md`
- For this machine’s host URL, DDC bus, and applied workarounds, see `docs/kiosk.local.md` (gitignored)
