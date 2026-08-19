# FamilyOS — Software System Design

## 1. Purpose and Scope

FamilyOS is a **locally running kiosk** on a wall-mounted touch display. One household uses it as a shared command center: calendar first, then lists, chores, and other domestic surfaces. It is read from across a kitchen (6–10 feet), not held in a hand.

It is **not** a multi-tenant SaaS product, a phone-first web app, or a per-person login system. Family members listed in Settings are **display identity** — colors, filters, avatars — not authentication principals. Companion phones/tablets are out of v1 scope.

v1: the week calendar in `src/components/calendar/`, the Lists screen in `src/components/lists/` (Google Tasks), the left nav rail, and Settings. Other rail destinations are stubs.

## 2. Architectural Decisions

**Decision: Shared kiosk, no FamilyOS accounts**
- Choice: Anyone at the display can use it. Google sign-in exists only to authorize Calendar and Tasks API access.
- Alternatives considered: Per-member FamilyOS logins; PIN unlock; cloud user directory.
- Rationale: The device is a fridge whiteboard. Auth would fight the product. Google OAuth is a calendar-provider credential, not a household identity system.

**Decision: Google Calendar is the event source of truth**
- Choice: Every calendar read and write goes to the Google Calendar configured in Settings. No local event table as the store.
- Alternatives considered: Local DB with later sync; CalDAV; iCloud; a FamilyOS-owned event schema that happens to import ICS.
- Rationale: `docs/requirements.md` — “syncs all reads and writes to the family calendar that is configured under Settings” and “integrate with Google Calendar by simply logging into Google.” Local cache for offline/latency is allowed; it must not become a second source of truth.

**Decision: Wall UI, light-only**
- Choice: Fixed 74px icon rail, equal-width columns, dense type, member pastels. Newsreader + Nunito Sans from the design skill. No dark mode. The week calendar in `src/` is the visual reference.
- Alternatives considered: Responsive collapsing nav; create-next-app Geist + `prefers-color-scheme` dark; a redesigned “modern” calendar.
- Rationale: The wall product is kitchen-distance, light-only, and already implemented. The scaffold’s marketing page, dark theme, and Geist fonts contradict it and should stay gone.

**Decision: Design skill is reference; `src/` is production**
- Choice: Copy tokens and reimplement components under `src/` as App Router / React modules. Use the skill’s `.d.ts` files as the component contract.
- Alternatives considered: Import `.cursor/skills/familyos-design/**` into the Next app; ship the `ui_kits/wall-display` HTML kit as the product.
- Rationale: The kit is a static prototype (`window.DS`, Lucide via CDN). It will not run as Next modules. Editing the skill to “make the app work” also breaks the design-skill workflow.

**Decision: Google Tasks is the list source of truth**
- Choice: Every list read and write goes to Google Tasks. Each Lists panel is one tasklist; rows are tasks. No local list table as the store.
- Alternatives considered: Device-local JSON next to `data/kiosk.json`; a FamilyOS-owned list schema.
- Rationale: Same pattern as Calendar. Household members can edit from phones via the Google Tasks app; the kiosk polls. Local cache for latency is allowed; it must not become a second source of truth.

**Decision: v1 is Calendar + Lists + Settings + stubs**
- Choice: 7-day family calendar, Lists (Google Tasks), and Settings (Google login + calendar picker). Tasks, Rewards, Meals, Recipes, Photos, Sleep render a “not yet implemented” screen.
- Alternatives considered: Building Tasks (chores) in parallel; inventing Rewards/Meals UI with no production screen yet.
- Rationale: Requirements started at the week calendar plus nav. Lists follows the same Google-as-store pattern. Invented screens become accidental product.

**Decision: Keep the Next.js App Router scaffold**
- Choice: Stay on this repo’s Next + React + Biome + pnpm setup. Next 16 APIs come from `node_modules/next/dist/docs/`, not training data.
- Alternatives considered: SPA-only Vite, Electron wrapper, replacing Biome with ESLint.
- Rationale: The app is already a Next app. Don’t add a second runtime or a second linter.

**Decision: FullPageOS Chromium kiosk, not a native shell**
- Choice: Raspberry Pi 5 + FullPageOS (X11 / matchbox / Chromium `--kiosk --app=`). The Next app is the product; the Pi is a browser pointed at it.
- Alternatives considered: Electron; Raspberry Pi OS desktop; Wayland + labwc/squeekboard.
- Rationale: FullPageOS is the intended wall OS. Don’t wrap the app in a second runtime. Device facts live in `docs/kiosk.md`; one machine’s live config in `docs/kiosk.local.md` (gitignored).

**Decision: Chromium extension OSK, not in-app and not Onboard**
- Choice: MV3 extension in `kiosk/osk/` shows a keyboard only while a text field is focused, on every origin including Google OAuth.
- Alternatives considered: GTK Onboard (worked, looked like 2010 Ubuntu a11y); a React keyboard in `src/` (matches the design system but cannot type into `accounts.google.com`).
- Rationale: The kiosk must type into FamilyOS fields *and* Google login. An in-app widget cannot. Don’t add a second OSK in React unless the extension is gone.

## 3. Component Boundaries

| Component | Owns | Must not own |
|-----------|------|----------------|
| App shell (`src/app` layout + rail) | Frame, routing between rail destinations, shared chrome | Google tokens, event fetch/write, member color assignment |
| Calendar | Week view, member filter chips, create/edit/delete events via Google | OAuth, calendar picker, unimplemented product surfaces |
| Lists | Multi-column checklists via Google Tasks | OAuth, chores/Tasks screen, unimplemented product surfaces |
| Settings | Google login/logout, which calendar is “the family calendar”, household members and their colors | Event rendering, unimplemented product surfaces |
| Stub screens | Placeholder for unimplemented rail ids | Real features, mock data presented as product |
| Kiosk OSK (`kiosk/osk`) | Chromium-wide on-screen keyboard (focus show / blur hide) | FamilyOS UI, Calendar, Settings, Google API |

Household member list (names, pastels, avatars) is display configuration, not an auth directory. Each member owns a unique pastel; that color is stored on the Google Calendar event (`colorId`) and read back as that person, so children do not need email addresses. Optional email still maps to attendees. Do not fork a parallel people database.

## 4. Data Flow and Contracts

```
Touch display (Pi 5 + FullPageOS Chromium)
  -> kiosk/osk extension (text fields only)
  -> Next.js App Router (src/app)
       -> Google Calendar API  (events; selected calendar id)
       -> Google Tasks API     (lists / items)
       -> Device-local settings (OAuth tokens + selected calendar id)
```

Straightforward request/response. No event bus, no multi-tenant routing.

**Canonical contracts**
- Visual spec: week calendar in `src/components/calendar/` plus design-skill tokens and `.d.ts` contracts. `docs/calendar.png` is a README capture of that UI, not a spec.
- Product scope: `docs/requirements.md`
- Wall device: `docs/kiosk.md`
- UI components/tokens: `.cursor/skills/familyos-design/` (`.d.ts` + `tokens/`); production copies live in `src/`
- Event shape: Google Calendar API events. Wrap at the adapter boundary; do not let Google’s payload leak through every component.

Settings persistence is device-local and gitignored (this repo already ignores `.env*`). Do not commit OAuth client secrets or refresh tokens.

## 5. Security Model

- **Authentication:** Google OAuth for Calendar and Tasks APIs. No FamilyOS user/password/session for household members.
- **Authorization:** The signed-in Google account may see every calendar it can access; the kiosk operates on **one** selected calendar. Do not write to other calendars.
- **Data:** Family names, events, and photos are household PII. They stay on the device and in Google Calendar. This is a local kiosk, not a public internet product — don’t add signup, sharing links, or a hosted multi-family backend.
- **Secrets:** Google client credentials and tokens never land in git. `.env*` is already ignored.

## 6. Known Traps

- `src/app` is still the create-next-app starter (Geist, dark mode, “Deploy Now”). Replace it; don’t build FamilyOS around that page.
- Do not import from `.cursor/skills/`. The kit’s `window.DS` / unpkg Lucide pattern is invalid in this Next app.
- Do not delete or “clean up” the `nextjs-agent-rules` block in `AGENTS.md`.
- The rail is 74px and always visible. No hamburger, no collapsing sidebar, no mobile bottom tab bar.
- Member pastels are identity: the same person uses the same tint on chips, events, and (later) tasks. Don’t pick colors for decoration. The pastel is written to Google Calendar as that event’s `colorId`; coloring an event in Google Calendar is how FamilyOS knows whose it is.
- Google Calendar allows one `colorId` per event. Multi-person events use graphite plus a private `familyosTones` property so the kiosk can round-trip several members.
- Multi-person events use the diagonal `--stripe-multi` fill, not a single member color.
- Unimplemented rail items stay stubs. Do not invent a visual language for Tasks, Rewards, Meals, Recipes, Photos, Sleep, or Settings beyond existing chrome.
- Biome is the linter (`pnpm lint`). Don’t add ESLint because Next tutorials use it.
- There is no test script yet. Don’t introduce a test framework unless the task needs one.
- On the reference panel, touch is USB-A (black USB 2.0), not the Pi USB-C power port and not HDMI. See `docs/kiosk.md`.
- Do not launch Onboard or add a React-only keyboard in `src/` for kiosk typing. The OSK is `kiosk/osk/`, loaded as a Chromium extension.
- Date/time inputs are not text fields; the extension leaves those to the native picker.

## 7. Future Direction

- Tasks (chores) should follow the design-skill kit (`ui_kits/wall-display`) after Lists is real. Keep shell/calendar/lists code from depending on those remaining feature modules.
- A local cache for calendar events may appear for snappy kiosk UX; Google Calendar remains authoritative.
- Companion surfaces (phone/tablet) are mentioned in the design skill and are not v1. Don’t add a responsive breakpoint architecture “for later.”
