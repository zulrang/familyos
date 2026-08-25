# Idle Dim is applied over loopback by the Trusted Display

Idle Dim is stored on the Server Installation with the Trusted Display, on the
same cookie-scoped path as Display size. The kiosk idle-dim process does not
hold a Display credential and does not poll the server. The Trusted Display
page applies timeout and brightness to a loopback HTTP endpoint that idle-dim
listens on (127.0.0.1 only, no token, not on the LAN). Apply happens on every
trusted page load and when Settings saves Idle Dim. If the panel is already
dimmed, a new dim-to takes effect immediately. A failed apply is ignored;
saving Display Configuration on the server still succeeds. Idle-dim keeps
last-good values locally when Chromium or the server is down. The browser
never invokes a shell.

Polling the Server Installation from the Pi would copy the pairing secret out of
Chromium. Native messaging would add an extension surface the OSK should not own.
A live preview in Settings would dim the wall under the form.
