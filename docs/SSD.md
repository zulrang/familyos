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

Implemented surfaces are pairing, the Five-Day Calendar in `src/calendar/`,
Lists in `src/lists/` (Google Tasks), Tasks in `src/tasks/`, Photos in
`src/photos/`, Settings, Rewards in `src/rewards/`, parent admin, and the fixed
left rail. Meals and Recipes remain stubs. Sleep on the rail starts the idle
slideshow (see `docs/photos.md`).

## Guiding Principles

Two principles every surface answers to. Where a decision isn't already
recorded, these decide the tie; overriding one is an ADR, not drift.

**One shared wall panel, all ages.** The primary device is a 1080p touchscreen
kiosk used by the whole Household, including children. Consequences that hold
everywhere: type and targets sized for kitchen distance (the 13px floor),
touch-first with no hover- or fine-pointer-only UI, no logins or gates a child
cannot pass (Members are not auth principals), and an appliance UI on the wall
rather than a personal one. Reference hardware is in `docs/kiosk.md`.

**Easy, pleasant, delightful.** Every interaction is easy, pleasant, and
delightful. Easy: short paths and large targets. Pleasant: the design skill's
calm visual language and responsive feel. Delightful means polish that rewards
use — never decorative animation, emoji chrome, or looping motion, which the
design skill forbids. Where delight and restraint conflict, restraint wins.

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

**Decision: Product surfaces ship as complete vertical slices**
- Choice: The implemented scope is pairing, a rolling 5-day family calendar,
  selected Household Lists, FamilyOS-owned Tasks, a Google Photos slideshow,
  Settings, Rewards, and parent admin. Meals and Recipes render a “not yet
  implemented” screen. Sleep is a rail action that starts the idle slideshow.
- Photos uses the Google Photos Picker API through the household Google
  connection and stores one explicitly selected photo batch. It does not
  browse or subscribe to albums. See `docs/photos.md` for setup, permissions,
  session limits, and slideshow behavior.
- Alternatives considered: Building Tasks (chores) in parallel; inventing Rewards/Meals UI with no production screen yet.
- Rationale: Lists follows the same Google-as-store pattern. Invented screens
  become accidental product. The Tasks surface means assigned chores, not
  Google Tasks list rows.

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
| Wall shell (`src/app/(display)/layout.tsx` + `src/shared/NavRail.tsx`) | Frame, routing between rail destinations, pairing gate, shared chrome | Google tokens, event fetch/write, member identity |
| Calendar (`src/calendar/`) | Five-Day View, member filters, event editing through the Google adapter | OAuth, calendar selection, identity inference from colors or attendees |
| Lists (`src/lists/`) | Selected multi-column Household Lists through the Google Tasks adapter | Personal/unselected tasklists, chores/Tasks screen |
| Tasks (`src/tasks/`) | Task Definitions, Task events, Bounties and Bounty Claims, star values, stored Star Balances and Star Adjustments (keyed by MemberId), the pure Occurrence projection, the Tasks screen, and the admin Tasks/Bounties/Stars pages | Google Tasks rows, Grant/Spend UX on the wall, verification workflow, member roster |
| Rewards (`src/rewards/`) | Reward catalog, Reward Goals, Reward Spends, the wall Rewards screen and admin catalog; receives the Task database from its routes | Importing `tasks`, a second Star Balance store, fulfillment tracking |
| Members (`src/members/`) | Household Member roster rules and admin Members page | Task reconciliation after retirement (owned by `tasks`, wired in the admin members route), provider identity |
| Displays (`src/displays/`) | Pairing UI and HTTP, Trusted Display records | Display session checks (in `src/shared/`), household data |
| Parent admin (`src/admin/`, `src/app/admin/`) | Mobile shell, PIN session gate, section navigation | Wall pairing, feature rules (pages compose slice components) |
| Photos (`src/photos/`) | Google Photos Picker session, shared Photo Selection, proxied media, and per-Display slideshow UI | Arbitrary album browsing, live album subscription, Google base URLs in the browser |
| Settings (`src/settings/`) | Provider Connection, source selection, members, Trusted Displays, Household Time Zone, Display Configuration (Display size, Idle Dim) | Event rendering, unimplemented product surfaces |
| Stub screens | Placeholder for unimplemented rail ids (Meals, Recipes) | Real features, mock data presented as product |
| Kiosk OSK (`kiosk/osk`) | Chromium-wide on-screen keyboard (focus show / blur hide) | FamilyOS UI, Calendar, Settings, Google API |

Household Members are shared server data, not an auth directory. There may be
at most six Active Members, each representing one person with a unique Member
Color (`#rrggbb`, FamilyOS-owned). Retiring a member keeps the identity record
for existing events, removes it from new-event choices, and frees the color for
reuse. Star Balance stays on that MemberId; Grants and Spends may still change
it. Member email is not a v1 field. See
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
       -> Google Photos Picker API (explicitly selected photo batch)

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
  Connection for Calendar, Lists, and Photos. The connected Google account is
  not automatically a Household Member.
- **Provider scope:** The account may see many calendars and tasklists;
  FamilyOS reads/writes one selected calendar and explicitly selected
  tasklists. Photos is limited to media the account explicitly chooses in a
  Picker session.
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
  `(task, window, kind)` event key makes plain HTTP retries safe for assigned
  Tasks; Bounty commands carry claim revisions and retry identities
  (`docs/design/bounties-design-spec.md`).
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
- Unimplemented rail items stay stubs. Do not invent a visual language for Meals or Recipes beyond existing chrome. Sleep has no screen; it starts the idle slideshow. Tasks is specified in `docs/design/tasks-design-spec.md`; build that, not the kit's tabs/points variant. Rewards follows `docs/rewards.md`. Photos setup and slideshow behavior are documented in `docs/photos.md`.
- Task data is FamilyOS-owned and append-only (ADR 0006), except Star Balance
  which is a mutable integer (ADR 0007). Do not store Tasks in Google Tasks,
  materialize occurrence rows, derive Star Balance from completions, add a
  verification workflow, or put Grant/Spend UX on the Tasks wall. Star values
  are captured in the editor; completion credits the stored integer. Rewards
  and parent admin now expose those stored balances and Grant/Spend controls.
- Biome is the linter (`pnpm lint`). Don’t add ESLint because Next tutorials use it.
- Tests are Vitest only (`pnpm test` / `pnpm test:contract`). Component tests need `// @vitest-environment jsdom` because the default env is `node`. Don’t add a second runner.
- On the reference panel, touch is USB-A (black USB 2.0), not the Pi USB-C power port and not HDMI. See `docs/kiosk.md`.
- Do not launch Onboard or add a React-only keyboard in `src/` for kiosk typing. The OSK is `kiosk/osk/`, loaded as a Chromium extension.
- Date/time inputs are not text fields; the extension leaves those to the native picker.

## 8. Future Direction

- Meals and Recipes are the remaining rail stubs. Keep shell/calendar/lists code from depending on other feature modules.
- Rewards owed and delivery tracking are deferred to issue #82.
- The parent admin is a separate mobile surface; the wall layout remains kiosk-oriented. Other companion surfaces are deferred.

## Rewards

The `/rewards` wall screen and `/admin/rewards` catalog are implemented. Mobile
`/admin/stars` uses the approved Manage stars layout. Domain, storage, access,
and deferred fulfillment details are in [rewards.md](rewards.md).


## Parent admin

`/admin` has a separate mobile shell and PIN session gate, without display
pairing. App routes compose Tasks, Bounties, Members, Stars, and Rewards pages
from the `tasks`, `members`, and `rewards` slices.
`src/shared/AdminEditorScreen.tsx` supplies the shared modal drawer: 90% viewport
height, independent scrolling, a round down-chevron close control, coordinated
drawer/backdrop animation, and reduced-motion support. Feature pages keep their
lists mounted underneath; forms own validation, saving, and cancellation.

Task/member/reward editors and star balance adjustments use the drawer.
Completion corrections remain inline. The shell's lock icon revokes the session.
See [Parent admin](admin.md) for setup, access rules, workflows, screenshots,
and the reusable component's interface.
