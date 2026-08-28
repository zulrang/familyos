# FamilyOS

A locally hosted kitchen-wall command center for one household and multiple
paired displays. v1 is a rolling five-day calendar, selected Google Tasks
lists, Settings, and the fixed navigation rail; Tasks, Rewards, Meals, Recipes,
Photos, and Sleep remain stubs.

It is not a cloud-hosted SaaS, not multi-tenant, and not a phone UI. You run one
FamilyOS server on a computer you control; wall panels connect over the local
network.

![FamilyOS calendar](docs/calendar.png)

`docs/calendar.png` is a 1920×1080 capture of the current seven-day
implementation (`pnpm dev`, then screenshot `/`). The v1 target is the
less-cramped Five-Day View defined in `docs/requirements.md`.

## Quick start

**Node.js 24.15+** (current LTS) and **pnpm 10**. Full walkthrough (OAuth, production bind, Pi kiosk, touchscreen): [INSTALL.md](INSTALL.md).

```bash
pnpm install
git config core.hooksPath .githooks
cp .env.example .env.local   # add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
pnpm dev
# enter the pairing code printed in the server log
```

Open [http://localhost:3001](http://localhost:3001) → pair the Display → **Settings** → sign in → pick the family calendar.

`pnpm start` is production on **3000**; `pnpm dev` is development on **3001**, so both can run. For a panel on the LAN, `pnpm build && pnpm start` (binds `0.0.0.0:3000`). `pnpm dev` over Wi-Fi makes taps feel late. On the household Mac, `./scripts/macos-server install` keeps `:3000` up across logins; `./scripts/macos-server update` pulls `main`, rebuilds, and restarts.

## Touchscreen

Laid out for a **1080p landscape** capacitive panel, read from across a kitchen. Mouse/trackpad in a desktop browser is fine for development. Phones are not a target.

The intended wall stack is a Raspberry Pi 5 running [FullPageOS](https://github.com/guysoft/FullPageOS) (Chromium kiosk). Picture is HDMI; touch is a separate USB HID cable. Reference hardware is a CAPERAVE CF15T + Goodix digitizer. Compatibility, cables, and what will not work: [INSTALL.md](INSTALL.md#touchscreen-compatibility). FullPageOS setup: [docs/kiosk.md](docs/kiosk.md).

## Docs

- [CONTEXT.md](CONTEXT.md) — canonical domain language
- [INSTALL.md](INSTALL.md) — clone, Google OAuth, wall kiosk, touchscreen
- [docs/SSD.md](docs/SSD.md) — architecture, boundaries, and remaining gaps
- [docs/kiosk.md](docs/kiosk.md) — FullPageOS Chromium, OSK extension, idle dim
- [docs/requirements.md](docs/requirements.md) — v1 scope
- [docs/code-design-principles.md](docs/code-design-principles.md) — coding standards for humans and agents
- [docs/adr/](docs/adr/) — architecture decision records
