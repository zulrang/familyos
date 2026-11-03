---
status: accepted
---

# A separate root guard puts the touchscreen back into multitouch mode

The reference panel can fall back to its mouse-mode USB interface after an
in-place USB reset. The kernel then receives every tap on an interface the kiosk
deliberately ignores (it would double taps in normal operation), so the wall
looks frozen while the server, browser and page are all healthy. Re-binding
`hid-multitouch` restores multitouch mode.

Recovery lives in its own root service, `familyos-touch-guard`, not in
`familyos-observe`. Observe stays an unprivileged, passive recorder (ADR 0010);
the guard needs root to read hidraw and write the driver bind files, and a fault
in one must not silence the other. The guard publishes only counters and a mode
to `/run/familyos-touch/state.json`, which observe reads and records. Neither
process logs report contents.

The trigger is a report on the mouse-mode interface while the multitouch
interface has been quiet for 2 seconds, re-binding at most every 30 seconds.
That costs the first tap after a fallback; detecting the fallback without a
tap would need probing the panel, which no evidence yet justifies. Unbinding
the mouse-mode interface or ignoring the reset was rejected: the panel would
stay out of multitouch mode either way.
