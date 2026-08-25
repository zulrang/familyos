# FamilyOS — Software System Design

## 1. Purpose and Scope

FamilyOS is a **locally hosted household command center** for wall-mounted touch
displays. One Server Installation on the local network represents one
Household and serves one or more Displays. It is read from across a kitchen
(6–10 feet), not held in a hand.

It is **not** a multi-tenant SaaS product, a phone-first web app, or a
per-person login system. Household Members are people represented in household
data, not authentication principals. Companion phones/tablets are out of v1
scope, although any paired browser profile follows the same Trusted Display
rules.

v1: pairing, the Five-Day Calendar in `src/calendar/`, Lists in
`src/lists/` (Google Tasks), Settings, and the fixed left rail.
Other rail destinations are stubs.

## 2. Architectural Decisions

**Decision: One Household server, multiple paired Displays**
- Choice: One Server Installation owns shared Household Configuration and
  serves multiple Displays. A Display is a paired browser profile; Display
  Configuration (Display size and Idle Dim) varies by Display.
- Alternatives considered: One independent installation per kiosk; a
  multi-household server; cloud synchronization between displays.
- Rationale: Household data and provider connections must be consistent across
  every wall display without introducing tenancy. See
  `docs/adr/0001-one-household-server-with-paired-displays.md`.

**Decision: Trusted Displays, no FamilyOS member accounts**
- Choice: A new Display pairs with a short-lived code. The first code is
  printed at server startup; any Trusted Display may later pair or revoke
  another. All Trusted Displays have equal control.
- Alternatives considered: Trusting every LAN client; per-member logins;
  display roles; recurring PIN unlock.
- Rationale: People should use the wall like a fridge whiteboard, but the
  unauthenticated LAN must not become a write API for household data. Google
  OAuth authorizes the provider connection, not a person using FamilyOS.

**Decision: Google Calendar is the event source of truth**
- Choice: Every calendar read and write goes to the one Google Calendar
  selected in Settings. No local event table is the write store.
- Alternatives considered: Local DB with later sync; CalDAV; iCloud; a FamilyOS-owned event schema that happens to import ICS.
- Rationale: Google remains editable from existing household devices. A
  server-side last-known cache supports stale read-only display, but never
  accepts offline writes or becomes a second source of truth.

**Decision: Stable IDs are the only Event Participant identity**
- Choice: FamilyOS stores stable Household Member IDs in Google event private
  properties. Zero IDs means Household Event. Event colors are presentation
  only; FamilyOS does not infer identity from color or attendee email.
- Alternatives considered: Treating Google `colorId` as member identity;
  inferring members from attendees; backfilling inferred IDs.
- Rationale: Colors are reusable and decorative. Making them identity corrupts
  history when a member retires or a tone is reused. See
  `docs/adr/0002-id-only-event-participants.md`.

**Decision: Wall UI, light-only**
- Choice: Fixed 74px icon rail, equal-width columns, dense type, member
  pastels. Newsreader + Nunito Sans from the design skill. No dark mode. The
  rolling Five-Day View starts today, pages in five-day increments, and
  contrasts weekend columns.
- Alternatives considered: Responsive collapsing nav; create-next-app Geist + `prefers-color-scheme` dark; a redesigned “modern” calendar.
- Rationale: The wall product is kitchen-distance and light-only. Five days
  gives events enough width; seven columns were too cramped and busy.

**Decision: Design skill is reference; `src/` is production**
- Choice: Copy tokens and reimplement components under `src/` as App Router / React modules. Use the skill’s `.d.ts` files as the component contract.
- Alternatives considered: Import `.cursor/skills/familyos-design/**` into the Next app; ship the `ui_kits/wall-display` HTML kit as the product.
- Rationale: The kit is a static prototype (`window.DS`, Lucide via CDN). It will not run as Next modules. Editing the skill to “make the app work” also breaks the design-skill workflow.

**Decision: Google Tasks is the list source of truth**
- Choice: Every list read and write goes to Google Tasks. Each explicitly
  selected Household List is one tasklist panel; rows are List Items. Removing
  a panel unselects it rather than deleting provider data.
- Alternatives considered: Device-local JSON next to `data/kiosk.json`; a FamilyOS-owned list schema.
- Rationale: Same authority pattern as Calendar. Explicit selection prevents a
  connected account's personal tasklists from appearing on the wall.

**Decision: FamilyOS owns Task data (Tasks surface)**
- Choice: Task Definitions and Task events live in a FamilyOS-owned
  `node:sqlite` store — the first local domain data beyond Household
  Configuration. Occurrences are a pure projection over append-only logs.
- Alternatives considered: Google Tasks as the chore store; JSON files like
  Household Configuration; adding better-sqlite3.
- Rationale: Rotation, Windows, and append-only events do not map onto
  tasklist rows, and the invariants want real unique constraints and
  transactions. See `docs/adr/0006-familyos-owned-task-store.md` and
  `docs/design/tasks-design-spec.md`.

**Decision: v1 is Calendar + Lists + Settings + stubs**
- Choice: Pairing, a rolling 5-day family calendar, selected Household Lists,
  and Settings (Google login, source selection, members, Displays). Tasks,
  Rewards, Meals, Recipes, Photos, and Sleep render a “not yet implemented”
  screen.
- Alternatives considered: Building Tasks (chores) in parallel; inventing Rewards/Meals UI with no production screen yet.
- Rationale: Lists follows the same Google-as-store pattern. Invented screens
  become accidental product. The future Tasks surface means assigned chores,
  not Google Tasks list rows.

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
| App shell (`src/app` layout + rail) | Frame, routing between rail destinations, pairing gate, shared chrome | Google tokens, event fetch/write, member identity |
| Calendar (`src/calendar/`) | Five-Day View, member filters, event editing through the Google adapter | OAuth, calendar selection, identity inference from colors or attendees |
| Lists (`src/lists/`) | Selected multi-column Household Lists through the Google Tasks adapter | Personal/unselected tasklists, chores/Tasks screen |
| Tasks (`src/tasks/`) | Task Definitions, Task events, star values and derived Star Balances, the pure Occurrence projection, the Tasks screen and Task editor | Google Tasks rows, Rewards redemption UX, verification workflow, member records |
| Settings (`src/settings/`) | Provider Connection, source selection, members, Trusted Displays, Household Time Zone, Display Configuration (Display size, Idle Dim) | Event rendering, unimplemented product surfaces |
| Stub screens | Placeholder for unimplemented rail ids | Real features, mock data presented as product |
| Kiosk OSK (`kiosk/osk`) | Chromium-wide on-screen keyboard (focus show / blur hide) | FamilyOS UI, Calendar, Settings, Google API |

Household Members are shared server data, not an auth directory. There may be
at most six Active Members, each representing one person with a unique Member
Color (`#rrggbb`, FamilyOS-owned). Retiring a member keeps the identity record
for existing events, removes it from new-event choices, and frees the color for
reuse. Member email is not a v1 field. See
`docs/adr/0003-member-color-is-familyos-owned.md`.

## 4. Data Flow and Contracts

```
Display(s) (paired browser profiles)
  -> local Server Installation (Next.js App Router)
       -> Household Configuration
       -> paired Display records + Display Configuration
       -> account-bound last-known provider cache
       -> Task store (node:sqlite; definitions + events, server-local)
       -> Google Calendar API  (events; one selected calendar)
       -> Google Tasks API     (explicitly selected lists / items)

Reference wall Display
  -> FullPageOS Chromium
  -> kiosk/osk extension (text fields only)
  -> familyos-idle-dim (panel backlight); Trusted Display page applies Idle Dim over loopback
```

Straightforward request/response. No event bus, multi-tenant routing, or
peer-to-peer Display synchronization.

**Canonical contracts**
- Domain language: `CONTEXT.md`
- Product scope: `docs/requirements.md`
- Decision records: `docs/adr/`
- Wall device: `docs/kiosk.md`
- UI components/tokens: `.cursor/skills/familyos-design/` (`.d.ts` + `tokens/`); production copies live in `src/`
- Event shape: Google Calendar API events. Wrap at the adapter boundary; do not let Google’s payload leak through every component.

Household Configuration, pairing credentials, provider tokens, and caches are
server-local and gitignored. Display Configuration is Display-specific. Do not
commit OAuth client secrets, refresh tokens, or pairing credentials.

## 5. Security Model

- **Display trust:** An unpaired client may load only readiness and pairing.
  Household reads and writes require a revocable Display credential.
- **People:** No FamilyOS user/password/session exists for Household Members.
  All Trusted Displays have equal control.
- **Provider authorization:** Google OAuth is one Household-level Provider
  Connection for Calendar and Tasks. The connected Google account is not
  automatically a Household Member.
- **Provider scope:** The account may see many calendars and tasklists;
  FamilyOS reads/writes one selected calendar and explicitly selected
  tasklists only.
- **Data:** Family names and provider data are household PII. They stay on the
  local server and in Google. Do not add signup, sharing links, or a hosted
  multi-family backend.
- **Secrets:** Google client credentials, tokens, and Display credentials
  never land in git.

## 6. Availability and Concurrency

- One Household Time Zone controls dates and day boundaries on every Display.
- The server owns one last-known Calendar/Lists cache per Google account and
  source. Disconnected or unavailable provider data remains visible but
  read-only.
- A different Google account never inherits or blends another account's cache.
- Google versions/ETags reject stale event and List Item writes. FamilyOS
  reloads the newer provider state instead of silently overwriting it.
- Household Configuration has a server-managed version and follows the same
  reject-and-reload rule for concurrent Settings edits.
- No offline write queue: Google remains the event/list write authority, and
  Displays submit Task events directly to the server. The idempotent
  `(task, window, kind)` event key makes plain HTTP retries safe.
- Task data is server-authoritative (ADR 0006): Tasks stay writable whenever
  the server is up, independent of Google availability.

## 7. Known Traps

- Do not import from `.cursor/skills/`. The kit’s `window.DS` / unpkg Lucide pattern is invalid in this Next app.
- Do not delete or “clean up” the `nextjs-agent-rules` block in `AGENTS.md`.
- The rail is 74px and always visible. No hamburger, no collapsing sidebar, no mobile bottom tab bar.
- Stable Household Member IDs in Google private event properties are the only
  Event Participant identity. Do not infer participants from `colorId`,
  attendees, or email.
- Member Colors are presentation. They are unique only among Active Members and
  may be reused after retirement. They are not Google Calendar colors.
- Multi-person events use the diagonal `--stripe-multi` fill, not a single member color.
- Unimplemented rail items stay stubs. Do not invent a visual language for Rewards, Meals, Recipes, Photos, or Sleep beyond existing chrome. Tasks is specified in `docs/design/tasks-design-spec.md`; build that, not the kit's tabs/points variant.
- Task data is FamilyOS-owned and append-only (ADR 0006). Do not store Tasks in Google Tasks, materialize occurrence rows or star balances, add a verification workflow, or render stars anywhere — star values are captured in the editor but display nothing until Rewards ships. The spec's decision log (D1–D19) rejects each of these by name.
- Biome is the linter (`pnpm lint`). Don’t add ESLint because Next tutorials use it.
- Tests are Vitest only (`pnpm test` / `pnpm test:contract`). Component tests need `// @vitest-environment jsdom` because the default env is `node`. Don’t add a second runner.
- On the reference panel, touch is USB-A (black USB 2.0), not the Pi USB-C power port and not HDMI. See `docs/kiosk.md`.
- Do not launch Onboard or add a React-only keyboard in `src/` for kiosk typing. The OSK is `kiosk/osk/`, loaded as a Chromium extension.
- Date/time inputs are not text fields; the extension leaves those to the native picker.

## 8. Future Direction

- Tasks is designed and ready to build: `docs/design/tasks-design-spec.md` (member columns per the design-skill kit, minus TimeOfDayTabs and the points pill). Keep shell/calendar/lists code from depending on the remaining feature modules.
- Companion surfaces (phone/tablet) are mentioned in the design skill and are not v1. Don’t add a responsive breakpoint architecture “for later.”
