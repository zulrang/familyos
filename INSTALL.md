# Install FamilyOS

FamilyOS is a **locally hosted kitchen-wall command center**, not a cloud
service. One server represents one household and serves one or more displays.
v1 uses a rolling five-day view of one selected Google Calendar and explicitly
selected Google Tasks lists. Other nav items (Tasks, and the rest) are stubs
until those screens exist.

You can run it in a desktop browser while you set it up. The wall unit is optional.

> On first startup (no Trusted Display yet) the Server Installation prints a
> short-lived pairing code. An unpaired browser only sees pairing UI and
> readiness; Household screens and APIs require the Display credential issued
> when that code is entered.

## What you need

- **Node.js 24.15+** (current LTS; Next.js 16 / Vitest / jsdom)
- **pnpm 10** — this repo pins `packageManager: pnpm@10.33.2`. `corepack enable` is the least painful way to get that version
- A **Google Cloud** project you control, with the Calendar API and Tasks API enabled
- A computer that can stay reachable if a wall panel will load the UI over the LAN

A touchscreen is not required to install or to click around in a browser.

## 1. Install

From a clone of this repo:

```bash
cd familyos
pnpm install
```

## 2. Google OAuth

FamilyOS has no per-person accounts. Google sign-in exists only so the
Household's server can talk to Calendar and Tasks; it is separate from
Household Member identity.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse one).
2. Enable **Google Calendar API** and **Google Tasks API**.
3. Configure the OAuth consent screen. External + yourself as a test user is enough for a household.
4. Create an OAuth client ID of type **Web application**.
5. Add this authorized redirect URI:

   `http://localhost:3000/api/auth/callback/google`

Create `.env.local` in the repo root (gitignored):

```
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
```

Login requests `calendar.events`, `calendar.calendarlist.readonly`, and `tasks`. Tokens are stored on the machine running Next, in `data/kiosk.json` (also gitignored) — not in the browser. Easiest path: sign in once from that machine. The wall display then uses the same server-side tokens. If you signed in before Tasks was added, sign out and back in so Google can grant the new scope.

If you insist on completing Google login **on the panel**, `GOOGLE_REDIRECT_URI` and the Cloud Console URI must be the origin Chromium actually loads (LAN hostname or IP), not `localhost`.

## 3. Run

```bash
pnpm dev
```

Watch the server log for `FamilyOS pairing code: ……`. Open
[http://localhost:3000](http://localhost:3000), enter the code to pair this
browser profile, then go to **Settings**, sign in with Google, pick the family
calendar, add household members and their colors. Save.

`pnpm dev` binds `0.0.0.0:3000`, so another device on the LAN can hit `http://<this-machine>:3000` already. For a wall panel, serve production instead — Fast Refresh over Wi-Fi makes taps feel drunk:

```bash
pnpm build && pnpm start
```

Same bind: `0.0.0.0:3000`.

## 4. Wall kiosk (optional)

The intended appliance is a Raspberry Pi 5 running [FullPageOS](https://github.com/guysoft/FullPageOS): X11, matchbox, Chromium `--kiosk`. The Pi does **not** host the Next app. Chromium loads whatever URL is in `/boot/firmware/fullpageos.txt`.

After flashing FullPageOS:

1. Put the production URL (the `pnpm start` host) in `fullpageos.txt`.
2. Copy the files under `kiosk/` onto the Pi — on-screen keyboard extension, Chromium flags, idle dim. Commands and the labeled reference stack: [`docs/kiosk.md`](docs/kiosk.md). Optional private runbook for one machine: `docs/kiosk.local.md` (gitignored).

SSH default on that image is `pi@fullpageos.local`.

---

## Touchscreen compatibility

FamilyOS is laid out for a **1080p landscape panel** read from 6–10 feet. The left rail is a fixed 74px. There is no phone layout, no collapsing nav, no “it also works in your pocket.”

### What works without a panel

A mouse or trackpad in Chrome/Chromium/Safari on a laptop is how you develop. Tap targets are large; a pointer is fine.

### What the wall unit expects

| Piece | Role |
| --- | --- |
| Picture | HDMI 1920×1080 |
| Touch | USB HID, picked up by Linux **libinput**, Chromium `--touch-events=enabled` |
| Typing | Chromium extension in `kiosk/osk/` (not an in-page widget, not Ubuntu Onboard) |
| Cursor | Hidden in the kiosk session (matchbox + unclutter). A pointer on screen means you are not in that session |

Reference hardware (one known-good stack): **Raspberry Pi 5** + **CAPERAVE CF15T** (EDID `CXK` / `CF15T`) + Goodix HID `27c6:0529` (“WingCool Inc. TouchScreen”).

Touch is a **separate cable** from video:

1. HDMI → Pi HDMI (picture)
2. Monitor power brick → monitor
3. **USB-A on the Pi → USB-C on the monitor** (touch)

Use a black USB **2.0** port on the Pi, a cable that actually carries data, and the monitor’s full-function USB-C. Not a charge-only cable. Not the Pi USB-C next to the power button (that’s power). On the reference panel, `lsusb` should show `Shenzhen Goodix Technology Co.,Ltd. TouchScreen`. Four root hubs and nothing else means the touch cable is on the wrong port.

### Other panels

A different capacitive 1080p HDMI panel will likely work if:

- Linux sees it as a **touchscreen** HID (`lsusb`, `libinput list-devices`)
- Chromium is launched with touch events (FullPageOS already does)
- You are in landscape 1920×1080, not stretching a portrait phone UI

Common failure modes, from the reference stack and from cheap HID panels in general:

- **Charge-only USB-C** — picture fine, zero touch
- **Pi 5 USB-C** used for touch — wrong jack
- Extra **mouse / stylus** nodes on the same VID/PID that double or offset taps. The reference panel needs udev `LIBINPUT_IGNORE_DEVICE` for those; see `docs/kiosk.md`
- **Pi 5 xHCI** dropping full-speed HID. The reference Pi 5 needed `usb_max_current_enable=1`, `usbcore.autosuspend=-1`, and an RP1 register poke at boot ([raspberrypi/linux#6079](https://github.com/raspberrypi/linux/issues/6079))
- Vendor **Windows-only** touch, or HDMI-CEC “touch,” with no standard HID — FamilyOS will not see taps
- OS-level keyboards (Onboard, squeekboard). The kiosk types through `kiosk/osk/` so Google’s login page gets a keyboard too. A React overlay in the Next app cannot

Phones and small tablets: the UI will render, badly. That is not a supported target.

If taps work but feel late, you are almost certainly still on `pnpm dev`. Switch to `pnpm start` and reload Chromium.
