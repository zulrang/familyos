# FamilyOS v1 Requirements

FamilyOS is a locally hosted household command center used from one or more
wall-mounted touch Displays. The reference Display is a Raspberry Pi 5 running
FullPageOS; see `docs/kiosk.md`.

One Server Installation represents one Household. It holds shared household
configuration and serves every Display on the local network. Each Display may
have its own UI scale; all other v1 configuration and data is shared.

## Access

- A new Display must pair with a short-lived code before it can read or change
  household data.
- The first pairing code is emitted by the Server Installation at startup.
- Any Trusted Display may pair another Display or revoke an existing one.
- An unpaired client may access only pairing and non-sensitive readiness
  information.
- Household Members do not log in. All Trusted Displays have equal control.

## Product surfaces

v1 includes Calendar, Lists, Settings, the fixed left navigation rail, and
pairing. Tasks, Rewards, Meals, Recipes, Photos, and Sleep remain
"not yet implemented" screens.

### Calendar

- Calendar opens to a rolling Five-Day View: today plus the next four days.
- Users can page backward or forward by five days and return to Today.
- Weekend columns use a contrasted background whenever they appear.
- One Household Time Zone defines dates and day boundaries on every Display.
- Reads and writes go to exactly one Google calendar selected in Settings.
- Google Calendar is authoritative; there is no separate local event source of
  truth.
- An event may explicitly identify zero or more Event Participants by stable
  Household Member ID. Color is presentation only and never establishes
  participation.
- An event with no participant IDs is a Household Event and remains visible
  regardless of member filters.
- Events for retired members remain visible and retain that member's identity.

### Lists

- Lists reads and writes go to Google Tasks.
- Settings explicitly selects which Google tasklists are Household Lists;
  unselected tasklists never appear on the wall.
- Each Household List is one panel and each row is a List Item.
- Adding a list creates and selects a real Google tasklist.
- Removing a panel only unselects the Google tasklist; it does not delete
  provider data.
- The separate Tasks destination is reserved for future chores and does not
  expose Google Tasks rows.

### Settings

- Google integration requires one Household-level Google login.
- The Provider Connection is not a Household Member identity.
- Settings selects one Household Calendar and zero or more Household Lists.
- Settings manages up to six active Household Members. Each member represents
  one person and has a unique active display tone; member email is not part of
  the v1 model.
- Retiring a member preserves the member record for existing events, prevents
  new assignment, and frees the tone for reuse.
- Settings changes are versioned so stale saves from another Display cannot
  silently overwrite them.

## Availability and conflicts

- The Server Installation keeps an account-bound last-known cache of Calendar
  and Lists data.
- When Google is unavailable or disconnected, cached provider data remains
  visible but read-only.
- Cache from one Google account must never be shown as data from another
  account.
- Stale Calendar and List Item writes are rejected and reloaded rather than
  silently overwriting a newer provider version.
