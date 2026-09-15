# FamilyOS v1 Requirements

FamilyOS is a locally hosted household command center used from one or more
wall-mounted touch Displays. The reference Display is a Raspberry Pi 5 running
FullPageOS; see `docs/kiosk.md`.

One Server Installation represents one Household. It holds shared household
configuration and serves every Display on the local network. Each Display has
its own Display Configuration (Display size and Idle Dim); all other v1
configuration and data is shared.

## Access

- A new Display must pair with a short-lived code before it can read or change
  household data.
- The first pairing code is emitted by the Server Installation at startup.
- Any Trusted Display may pair another Display or revoke an existing one.
- An unpaired client may access only pairing and non-sensitive readiness
  information.
- Household Members do not log in. All Trusted Displays have equal control.

## Product surfaces

The implemented product surfaces are Calendar, Lists, Tasks, Photos, Rewards,
Settings, the fixed left navigation rail, and pairing. Meals and Recipes
remain "not yet implemented" screens. Sleep on the rail starts the idle
slideshow rather than opening a screen.

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
- The separate Tasks destination contains FamilyOS-owned household chores and
  routines; it does not expose Google Tasks rows. Its requirements are in
  `docs/design/tasks-design-spec.md`.

### Tasks

- Tasks is FamilyOS-owned household work stored on the Server Installation; it
  does not use Google. Assigned Tasks follow
  `docs/design/tasks-design-spec.md`; Bounties follow
  `docs/design/bounties-design-spec.md`.
- Parents create and manage Tasks and Bounties in the parent admin
  (`docs/admin.md`).

### Rewards

- Rewards supports a parent-managed household catalog, one unreserved goal per
  active member, and atomic Spends retaining the original reward name and cost.
  See [Rewards](rewards.md); rewards owed and fulfillment are deferred to #82.

### Photos

- Photos uses the Household Provider Connection and the Google Photos Picker
  API. It does not require a separate OAuth client.
- A household member explicitly chooses a Photo Selection. FamilyOS cannot
  browse arbitrary Google Photos albums or subscribe to later album changes.
- The selected batch is shared by every Trusted Display. Slideshow position,
  pause state, and view mode are local to each Display.
- The slideshow advances every 15 seconds and supports Previous, Pause/Play,
  and Next. Photos fit within the available area without cropping.
- Full-screen mode uses a black background. Its controls fade after three
  seconds, reappear after a click or tap, and can exit through the visible
  button or the Escape key.
- Google media URLs stay server-side. Trusted Displays receive images through
  the authenticated FamilyOS image endpoint.
- Photo Selection and authorization setup are documented in `docs/photos.md`.

### Settings

- Google integration requires one Household-level Google login.
- The Provider Connection is not a Household Member identity.
- Settings selects one Household Calendar and zero or more Household Lists.
- The Photos screen manages the shared Photo Selection; Settings owns the
  Household Provider Connection it uses.
- Settings manages up to six Active Members. Each holds a unique Member Color
  chosen in FamilyOS (not a Google Calendar color); member email is not part of
  the v1 model.
- Retiring a member preserves the member record for existing events, prevents
  new assignment, and frees the Member Color for reuse.
- Settings changes are versioned so stale saves from another Display cannot
  silently overwrite them.

## Availability and conflicts

- The Server Installation keeps an account-bound last-known cache of Calendar
  and Lists data.
- When Google is unavailable or disconnected, cached provider data remains
  visible but read-only.
- Cache from one Google account must never be shown as data from another
  account.
- Photos retains Picker session metadata and the selected media references,
  but it does not cache image files. Photos may be unavailable while Google is
  unreachable.
- Stale Calendar and List Item writes are rejected and reloaded rather than
  silently overwriting a newer provider version.
