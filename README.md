# FamilyOS

A locally hosted kitchen-wall command center for one household and multiple
paired displays. The implemented product surfaces are a rolling five-day
calendar, selected Google Tasks lists, household Tasks, a Google Photos
slideshow, Rewards, Settings, and the fixed navigation rail. Meals and Recipes
remain stubs. Sleep on the rail starts the idle slideshow.

You run one FamilyOS server on a computer you control; wall panels connect over
the local network. Parents can manage assigned Tasks, Bounties, Members,
Rewards, completion corrections, and Star Balances from the separate mobile
interface at `/admin`.

![FamilyOS calendar](docs/calendar.png)

`docs/calendar.png` is an older 1920×1080 capture from the seven-day calendar.
The current calendar is the rolling Five-Day View defined in
`docs/requirements.md`.

## Quick start

**Node.js 24.15+** (current LTS) and **pnpm 10**. Full walkthrough (OAuth, production bind, Pi kiosk, touchscreen): [INSTALL.md](INSTALL.md).

```bash
pnpm install
git config core.hooksPath .githooks
cp .env.example .env.local   # add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
pnpm dev
# enter the pairing code printed in the server log
```

Open [http://localhost:3001](http://localhost:3001) → pair the Display →
**Settings** → sign in → choose the household Google sources. See
[docs/photos.md](docs/photos.md) for the one-time Photos selection flow.

`pnpm start` is production on **3000**; `pnpm dev` is development on **3001**, so both can run. For a panel on the LAN, `pnpm build && pnpm start` (binds `0.0.0.0:3000`). `pnpm dev` over Wi-Fi makes taps feel late. On the household Mac, `./scripts/macos-server install` keeps `:3000` up across logins; `./scripts/macos-server update` pulls `main`, rebuilds, and restarts.

## Parent admin

Set a six-digit `FAMILYOS_ADMIN_PIN` in the server's environment or `.env.local`
and restart. Open `/admin` on home Wi-Fi; display pairing is not required.
Safari's **Share → Add to Home Screen** provides standalone access. Sessions
lock after 15 minutes of inactivity; the header's lock icon locks immediately.

Manage assigned Tasks, Bounties, Members, Rewards, completion corrections, and
Star Balances.
Create/edit forms and star adjustments open in 90%-height drawers with their own
scrolling area and a circular down-chevron close button. The list stays visible
underneath.

See the [admin guide and mobile screenshots](docs/admin.md) for workflows, access
rules, and storage behavior, or the [remote mobile preview runbook](docs/agents/mobile-preview.md)
to preview changes from another computer.

## Agent access

Agents can manage assigned Tasks and confirm Reward Spends through `/api/mcp`.
Set a separate `FAMILYOS_MCP_TOKEN` to enable access; see the
[MCP setup and tool guide](docs/mcp.md).

## Touchscreen

The main UI is laid out for a **1080p landscape** capacitive panel, read from across a kitchen. Mouse/trackpad in a desktop browser is fine for development. The parent admin interface is designed for iPhones.

The intended wall stack is a Raspberry Pi 5 running [FullPageOS](https://github.com/guysoft/FullPageOS) (Chromium kiosk). Picture is HDMI; touch is a separate USB HID cable. Reference hardware is a CAPERAVE CF15T + Goodix digitizer. Compatibility, cables, and what will not work: [INSTALL.md](INSTALL.md#touchscreen-compatibility). FullPageOS setup: [docs/kiosk.md](docs/kiosk.md).

## Docs

- [CONTEXT.md](CONTEXT.md) — canonical domain language
- [INSTALL.md](INSTALL.md) — clone, Google OAuth, wall kiosk, touchscreen
- [docs/SSD.md](docs/SSD.md) — architecture, boundaries, and remaining gaps
- [docs/kiosk.md](docs/kiosk.md) — FullPageOS Chromium, OSK extension, idle dim
- [docs/admin.md](docs/admin.md) — parent admin setup, workflows, and mobile screenshots
- [docs/photos.md](docs/photos.md) — Google Photos setup and slideshow behavior
- [docs/requirements.md](docs/requirements.md) — v1 scope
- [docs/design/tasks-design-spec.md](docs/design/tasks-design-spec.md) — assigned Tasks and legacy compatibility
- [docs/design/bounties-design-spec.md](docs/design/bounties-design-spec.md) — Bounty lifecycle and cutover contract
- [docs/code-design-principles.md](docs/code-design-principles.md) — coding standards for humans and agents
- [docs/adr/](docs/adr/) — architecture decision records
