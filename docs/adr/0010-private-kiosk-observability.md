---
status: accepted
---

# Keep kiosk diagnostics in a separate private Pi process

The wall can lose renderer responsiveness while Chromium's browser process and the server still answer. The LAN inspect bridge is interactive, exposes raw console/page data, and can itself wait on a renderer call. A separate `pi` systemd service probes the browser CDP endpoint, kiosk page, and server readiness independently, then writes bounded, private JSONL on the Pi. It records only allowlisted network/error categories and process summaries, never console text, URLs, credentials, request bodies, or page content. This gives a surviving timeline across browser restarts without turning diagnostics into a watchdog or adding a remote telemetry endpoint. Its own transport code stays independent of inspect so a bridge regression cannot suppress the same incident evidence; any future shared transport must preserve that process and failure isolation.
