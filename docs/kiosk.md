# Wall kiosk (FullPageOS)

The intended appliance is a Raspberry Pi 5 running **FullPageOS** (X11, LightDM, matchbox, Chromium `--kiosk --app=`). The Pi does not host the Next app. Chromium loads whatever URL is in `/boot/firmware/fullpageos.txt`.

SSH on that image defaults to `pi@fullpageos.local` (user `pi`). App code stays in `src/`. Repo copies of the Chromium flags, OSK, and idle-dim script live under `kiosk/`.

Facts about **one physical unit** (which host serves the app, DDC bus number, workarounds already applied) belong in `docs/kiosk.local.md`, which is gitignored.

## Reference hardware

One known-good stack, used to prove the kiosk path:

- **Board:** Raspberry Pi 5
- **Panel:** CAPERAVE CF15T (EDID `CXK` / `CF15T`), 1920×1080 HDMI
- **Touch:** Goodix HID `27c6:0529` (“WingCool Inc. TouchScreen”)

Picture and touch are separate cables:

1. HDMI → Pi HDMI (picture)
2. Monitor power brick → monitor
3. USB-A on the Pi → USB-C on the monitor (touch). Use a **black USB 2.0** port, a data cable, and the monitor’s full-function USB-C — not a charge-only cable and not the Pi USB-C next to the power button.

`lsusb` should show `Shenzhen Goodix Technology Co.,Ltd. TouchScreen`. Four root hubs and nothing else means the touch cable is on the wrong port.

Other 1080p HDMI panels can work if Linux libinput sees a touchscreen HID. See [INSTALL.md](../INSTALL.md#touchscreen-compatibility).

## Touch

Chromium already launches with `--touch-events=enabled`. libinput picks up the HID device.

Cheap panels (including the reference CF15T) often also expose mouse and stylus nodes that double or offset taps. Ignore those with udev `LIBINPUT_IGNORE_DEVICE` for that VID/PID when `ID_INPUT_MOUSE` or `ID_INPUT_TABLET` (on the reference unit: `/etc/udev/rules.d/99-wingcool-touchscreen.rules`).

Pi 5 xHCI is hostile to some full-speed HID devices. The reference stack needed:

- `usb_max_current_enable=1` in `config.txt`
- `usbcore.autosuspend=-1` on `/boot/firmware/cmdline.txt`
- a systemd unit that writes RP1 registers `0x1f0020c12c` and `0x1f0030c12c` to `0x05010010` at boot ([raspberrypi/linux#6079](https://github.com/raspberrypi/linux/issues/6079))

Whether those are already applied on a given Pi is a local-doc fact.

## Display lag

`pnpm dev` over LAN is the usual reason taps feel slow: unminified modules, Fast Refresh, React Strict Mode. For the kiosk, serve production instead:

```bash
pnpm build && pnpm start
```

`pnpm start` binds `0.0.0.0:3000` so the Pi can reach it. Reload Chromium after the switch.

Pi Chromium also ships `--force-renderer-accessibility` (screen-reader tree on every tap). `/etc/chromium.d/familyos-perf` strips that and raises raster threads. Repo copy: `kiosk/chromium.d/familyos-perf`.

```bash
scp kiosk/chromium.d/familyos-perf pi@fullpageos.local:/tmp/familyos-perf
ssh pi@fullpageos.local 'sudo cp /tmp/familyos-perf /etc/chromium.d/familyos-perf'
# restart Chromium only (do not pkill -f a path that also appears in the SSH command line)
ssh pi@fullpageos.local 'pid=$(ps -C chromium -o pid=,args= | awk "/--kiosk/{print \$1; exit}"); kill "$pid"'
```

`run_onepageos` brings Chromium back.

## Cursor

Hidden for the wall: `matchbox-window-manager -use_cursor no` and `unclutter-xfixes --timeout 0 --jitter 5 --hide-on-touch --start-hidden --fork` in `/opt/custompios/scripts/start_gui`. Taps should not show a pointer. A Bluetooth trackpad still can, while it is moving.

## On-screen keyboard

Not Onboard. Not a React overlay in `src/` (that would miss Google’s login page).

A Chromium MV3 extension in `kiosk/osk/` injects a FamilyOS-styled keyboard on `input` / `textarea` / `contenteditable` focus and hides it on blur. It runs on every origin Chromium loads, including Google OAuth. Date/time/`inputmode=none` fields are skipped.

Install it on the Pi at `/usr/share/chromium/extensions/familyos-osk`. FullPageOS already passes `--load-extension=` for that directory (`/etc/chromium.d/extensions`). After changing the extension:

```bash
rsync -az --exclude check.js kiosk/osk/ pi@fullpageos.local:/tmp/familyos-osk/
ssh pi@fullpageos.local 'sudo cp -a /tmp/familyos-osk/. /usr/share/chromium/extensions/familyos-osk/'
# then restart Chromium only (do not pkill -f a path that also appears in the SSH command line)
ssh pi@fullpageos.local 'kill $(pgrep -n -f /usr/lib/chromium/chromium)'
```

`run_onepageos` brings Chromium back. Field rules: `node kiosk/osk/check.js`.

Rejected: stock Onboard (ugly, AT-SPI auto-show was flaky in kiosk); in-app-only OSK (no Google login). Do not launch `/opt/custompios/scripts/start_onboard` from `start_gui`.

## Secure origin

Chromium does not treat `http://*.local` or LAN IPs as secure contexts. `/etc/chromium.d/familyos-secure-origin` adds `--unsafely-treat-insecure-origin-as-secure` for the URL in `fullpageos.txt` (and pins `--user-data-dir` so Chromium honors the flag).

Repo copy: `kiosk/chromium.d/familyos-secure-origin`. After changing it:

```bash
scp kiosk/chromium.d/familyos-secure-origin pi@fullpageos.local:/tmp/familyos-secure-origin
ssh pi@fullpageos.local 'sudo cp /tmp/familyos-secure-origin /etc/chromium.d/familyos-secure-origin'
ssh pi@fullpageos.local 'kill $(pgrep -n -f /usr/lib/chromium/chromium)'
```

If the kiosk URL in `fullpageos.txt` changes, restart Chromium so the flag picks up the new origin.

## Remote inspect

iPad Safari/Chrome have no `chrome://inspect`, and Pi Chromium 130 does not
serve a DevTools UI on the debug port. Console and eval go through a small
LAN page; CDP itself stays on loopback.

`/etc/chromium.d/familyos-remote-debug` adds `--remote-debugging-port=9222`
(localhost only). `familyos-inspect` listens on **7381** (all interfaces)
and bridges to that port.

On the iPad, while you use the panel, open:

`http://fullpageos.local:7381/`

If `.local` does not resolve, use the Pi’s LAN IP instead. Anyone on that
LAN can read the console and run JavaScript in the wall browser (Display
cookie included). Do not forward 7381 off the house network.

Repo copies: `kiosk/chromium.d/familyos-remote-debug`, `kiosk/inspect`.
`kiosk/inspect --check` is the formatter self-test. After changing them:

```bash
scp kiosk/chromium.d/familyos-remote-debug pi@fullpageos.local:/tmp/familyos-remote-debug
scp kiosk/inspect pi@fullpageos.local:/tmp/familyos-inspect
ssh pi@fullpageos.local 'sudo cp /tmp/familyos-remote-debug /etc/chromium.d/familyos-remote-debug'
ssh pi@fullpageos.local 'sudo cp /tmp/familyos-inspect /opt/custompios/scripts/familyos-inspect && sudo chmod 755 /opt/custompios/scripts/familyos-inspect'
# start_gui should launch it (once): /opt/custompios/scripts/familyos-inspect &
ssh pi@fullpageos.local 'XDG_RUNTIME_DIR=/run/user/$(id -u) setsid -f /opt/custompios/scripts/familyos-inspect'
ssh pi@fullpageos.local 'pid=$(ps -C chromium -o pid=,args= | awk "/--kiosk/{print \$1; exit}"); kill "$pid"'
```

`run_onepageos` brings Chromium back. The inspect page shows “waiting for
Chromium…” until the debug port is up.

## Idle dim

DPMS stays off so the panel never blanks. After idle with no X input,
`familyos-idle-dim` sets backlight VCP 10 via DDC and restores the previous
value on tap. Timeout and dim-to are Display Configuration: Settings on this
Trusted Display saves them, and the kiosk Chromium page POSTs
`{"idleDimAfterMs":300000,"idleDimTo":10}` to `http://127.0.0.1:7380/idle-dim`
(loopback only). Last-good values live in `$XDG_RUNTIME_DIR/familyos-idle-dim.cfg`;
missing config uses 5 minutes and 10%. Replacing the script still needs a
process restart so it listens; changing the values does not need a Display
reboot.

Needs `xprintidle`, `ddcutil`, `python3`, `i2c-dev` at boot (`/etc/modules`),
and `pi` in group `i2c`. The reference Pi 5 ports are tried automatically:
HDMI-1 on bus 11 and HDMI-2 on bus 12. `DDC_BUS` can pin a different port- and
panel-specific bus; record overrides in `docs/kiosk.local.md`.

Repo copy: `kiosk/idle-dim`. After changing it:

```bash
scp kiosk/idle-dim pi@fullpageos.local:/tmp/familyos-idle-dim
ssh pi@fullpageos.local 'sudo cp /tmp/familyos-idle-dim /opt/custompios/scripts/familyos-idle-dim && sudo chmod 755 /opt/custompios/scripts/familyos-idle-dim'
ssh pi@fullpageos.local 'fuser -k /run/user/$(id -u)/familyos-idle-dim.lock 2>/dev/null; DISPLAY=:0 XDG_RUNTIME_DIR=/run/user/$(id -u) /opt/custompios/scripts/familyos-idle-dim &'
```

`familyos-idle-dim --check` prints current idle ms and brightness.

## Session scripts

`/opt/custompios/scripts/start_gui` (LightDM session `guisession`):

- power management off, orientation `normal`
- `familyos-idle-dim` (backlight Idle Dim; loopback apply on 127.0.0.1:7380)
- `familyos-inspect` (LAN console on :7381; CDP on 127.0.0.1:9222)
- matchbox without cursor
- unclutter-xfixes
- `run_onepageos` → `start_chromium_browser` (kiosk Chromium + touch-events)
