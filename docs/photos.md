# Photos

The Photos screen displays a slideshow from one Google Photos album selected
for the household. All paired Displays share this selection. Photos advance
every 15 seconds; Previous, Next, and Pause are available below the viewer.
Images fit the display without cropping.

## Setup

1. Enable `photosambient.googleapis.com` in the Google Cloud project.
2. Create an OAuth client with application type **TVs and Limited Input devices**.
3. Save `GOOGLE_PHOTOS_CLIENT_ID` and `GOOGLE_PHOTOS_CLIENT_SECRET` in
   `.env.local`. These are separate from the Calendar/Tasks web client.
4. Restart the server to load the environment, then open **Photos → Connect
   Google Photos** on a paired Display.
5. Scan the QR code on a phone or follow the sign-in link, enter the displayed
   code, and grant access. Select exactly one album for **FamilyOS** in Google
   Photos. The screen waits if no source or multiple sources are selected.

The Google Photos partner program documents Ambient access as requiring
acceptance. Enabling the API and successfully obtaining a device sign-in code
do not by themselves verify that media access is approved. Permission errors
are shown in the connection screen.

**Photo settings** opens the Google selection link again. Disconnect removes
local credentials and cached media references immediately and attempts to
remove the Ambient device in Google. If Google is unavailable during
disconnect, remove the FamilyOS device through Google Photos settings.

## Implementation

`src/photos/` owns the OAuth device flow, server connection, protected media
proxy, and viewer. `src/app/photos/` and `src/app/api/photos/` are thin routes.
Tokens, pending authorization, the Ambient device, and temporary media
references live in `data/photos.json`, written atomically with owner-only
permissions. The existing Calendar/Tasks authorization is independent.

One household Ambient device supplies a curated batch of up to 100 photos.
This is Ambient mode, not an exhaustive album browser. Batches refresh at
most once every ten minutes across all Displays, including failed attempts,
to stay below the documented 240 media-list requests per device per day.
Device selection is checked periodically; changing the source clears the old
batch. A new batch may wait for the remaining ten-minute refresh interval.
Media references expire locally after 50 minutes. Image bytes are streamed
through a paired-display endpoint with no-store headers, never through the
public Next image optimizer or a permanent local photo library.

OAuth polls respect the provider's interval and `slow_down` responses. A
persisted request ID supports recovery from an interrupted device creation.
Operations serialize inside the server process; run only one serving process
against a given `FAMILYOS_DATA_DIR`. Development and production need separate
data directories if both use Photos simultaneously.

## References

- [Ambient configuration and device OAuth](https://developers.google.com/photos/ambient/guides/configure-your-app)
- [Ambient access requirements](https://developers.google.com/photos/partner-program/overview#ambient-api)
- [Device resource and selected sources](https://developers.google.com/photos/ambient/reference/rest/v1/devices)
- [Media batches and quota](https://developers.google.com/photos/ambient/reference/rest/v1/mediaItems/list)
- [Image URL parameters](https://developers.google.com/photos/ambient/guides/media-items)
