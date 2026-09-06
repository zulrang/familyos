# Photos

The Photos screen uses the Google Photos Picker API. A household member signs
in through the existing Google connection, scans a Picker link, searches for
the family album in Google Photos, selects its photos, and taps Done. FamilyOS
then shows the selected photo batch as a slideshow on every paired Display.

Google no longer permits third-party applications to list arbitrary existing
albums through the Library API, and Ambient API access requires Google partner
approval. Picker is the supported replacement for user-selected content. It
does not maintain a live album subscription: when the album changes, open
Photo settings and select the photos again.

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

Picker sessions and their temporary media URLs are retained on the server for
the session lifetime. Media URLs are refreshed approximately every 50 minutes
while the session remains valid. If Google expires the session, select the
photos again. FamilyOS never exposes Google base URLs to the browser; images
stream through a paired-Display endpoint with no-store headers.

Disconnect clears the local session and selected media immediately, then
attempts to delete the Google Picker session. If Google is unavailable, local
disconnect still succeeds.

## References

- [Configure Google Photos APIs](https://developers.google.com/photos/overview/configure-your-app)
- [Picker sessions](https://developers.google.com/photos/picker/guides/sessions)
- [Photo picking experience](https://developers.google.com/photos/picker/guides/picking-experience)
- [List and retrieve picked media](https://developers.google.com/photos/picker/guides/media-items)
- [Photos API changes](https://developers.google.com/photos/support/updates)
