# Photos

The Photos screen uses the Google Photos Picker API. A household member signs
in through the existing Household Provider Connection, scans a Picker link,
searches for the family album in Google Photos, selects its photos, and taps
Done. That explicit Photo Selection becomes the slideshow source on every
Trusted Display.

Google no longer permits third-party applications to list arbitrary existing
albums through the Library API, and Ambient API access requires Google partner
approval. Picker is the supported replacement for user-selected content. It
does not grant FamilyOS access to the album itself or maintain a live album
subscription. When the album changes, open **Photo settings** and select the
desired photos again.

## Setup

1. Enable the **Google Photos Picker API** in the same Google Cloud project as
   Calendar and Tasks. This is separate from the Google Drive Picker API and
   from the Photos Ambient API.
2. Keep the existing Google web OAuth client in `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.
3. Open **Settings → Sign out**, then **Sign in with Google** again so the
   account grants the new `photospicker.mediaitems.readonly` scope.
4. Open **Photos → Connect Google Photos**. Scan the Picker QR code or open its
   link, search for the album by name, select its photos, and tap **Done**.

There are no Photos-specific client ID, secret, redirect URI, or environment
variables. The OAuth callback uses the origin from which the sign-in flow was
started and `/api/auth/callback/google`. The recommended household setup is to
complete Google sign-in from `http://localhost:3000`; non-localhost web-client
redirects must use an authorized HTTPS domain.

## Slideshow

- The slideshow changes photos every 15 seconds. **Previous**, **Pause
  slideshow**/**Play slideshow**, and **Next** operate on the current Display;
  they do not change the position or pause state of another Display.
- Images use `object-fit: contain`, preserving the entire photo without
  cropping. Empty space may appear around images whose aspect ratio differs
  from the Display.
- **Full screen** covers the FamilyOS viewport and uses a black background. On
  the wall kiosk, that viewport is already the physical screen because
  Chromium runs in kiosk mode.
- Full-screen controls fade out after three seconds. Click or tap anywhere to
  show them again. Use **Exit full screen** or the Escape key to return to the
  standard Photos view.
- Picker can return images and videos; the FamilyOS slideshow displays raster
  images only.
- After the Display's configured Idle Dim timeout without interaction, photos
  automatically play full screen with no controls. Tap anywhere (or press a
  key) to return to the previous screen, preserving its in-progress state.
  The wake-up tap does not activate controls underneath. If no photos are
  available, the current screen stays visible. Hardware backlight dimming
  continues independently on the kiosk.
- **Sleep** in the navigation rail starts this idle slideshow immediately.
  Waking returns to the same screen with its in-progress state preserved.

The Photo Selection is shared server state. Slideshow position, pause state,
and full-screen state are local UI state on each Display.

## Session and media handling

Picker session data and temporary media URLs are retained in the server's
private data directory for the session lifetime. Media URLs are refreshed
approximately every 50 minutes while the session remains valid. If the server
restarts after the user taps Done, it resumes the saved session and imports the
completed selection. If Google expires the session, select the photos again.

FamilyOS never exposes Google base URLs to the browser. Images stream through
an endpoint available only to Trusted Displays with private, no-store headers.
The server requests images up to 2560×1440 from Google.

Disconnect clears the local session and selected media immediately, then
attempts to delete the Google Picker session. If Google is unavailable, local
disconnect still succeeds.

## References

- [Configure Google Photos APIs](https://developers.google.com/photos/overview/configure-your-app)
- [Picker sessions](https://developers.google.com/photos/picker/guides/sessions)
- [Photo picking experience](https://developers.google.com/photos/picker/guides/picking-experience)
- [List and retrieve picked media](https://developers.google.com/photos/picker/guides/media-items)
- [Photos API changes](https://developers.google.com/photos/support/updates)
- [OAuth web-server redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)
