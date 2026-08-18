This is a locally running kiosk application that the family will use from a touch screen
(Raspberry Pi 5 + FullPageOS; see `docs/kiosk.md`).

The first version is a week calendar plus the left navigation (most destinations show a "not yet implemented" screen). The calendar UI in `src/components/calendar/` is the visual reference.

This calendar syncs all reads and writes to the family calendar that is configured under Settings.

Must integrate with Google Calendar by simply logging into Google.
