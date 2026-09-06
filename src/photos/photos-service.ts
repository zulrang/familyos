import { AuthError } from "@/shared/auth-error";
import { readProvider } from "@/shared/provider";
import {
  createPickerSession,
  deletePickerSession,
  fetchPhoto,
  getPickerSession,
  listPickerPhotos,
} from "./google-photos";
import type { PhotosConnection, PhotosStatus } from "./photos";
import {
  readPhotosConnection,
  withPhotosConnection,
  writePhotosConnection,
} from "./photos-store";

const MEDIA_INTERVAL = 50 * 60_000;
async function signedIn() {
  return Boolean((await readProvider()).tokens?.access_token);
}
function publicStatus(
  connection: PhotosConnection,
  connected: boolean,
): PhotosStatus {
  if (!connected) return { state: "unconfigured" };
  if (connection.state === "disconnected") return connection;
  if (connection.state === "selecting")
    return {
      state: "selecting",
      pickerUrl: connection.pickerUrl,
      pollAfterMs: Math.max(1000, connection.nextPollAt - Date.now()),
    };
  return {
    state: "ready",
    pickerUrl: connection.pickerUrl,
    sourceName: "Selected Google Photos",
    photos:
      Date.now() < connection.mediaExpiresAt
        ? connection.photos.map((p) => ({
            id: p.id,
            src: `/api/photos/image?id=${encodeURIComponent(p.id)}&v=${connection.mediaExpiresAt}`,
          }))
        : [],
    pollAfterMs: Math.max(
      5000,
      Math.min(connection.nextPollAt, connection.nextMediaPollAt) - Date.now(),
    ),
  };
}
export function getPhotosStatus() {
  return withPhotosConnection(async () =>
    publicStatus(await readPhotosConnection(), await signedIn()),
  );
}
export function connectPhotos() {
  return withPhotosConnection(async () => {
    if (!(await signedIn())) return { state: "unconfigured" } as const;
    const current = await readPhotosConnection();
    if (current.state !== "disconnected") return publicStatus(current, true);
    const session = await createPickerSession();
    const connection: PhotosConnection = {
      state: "selecting",
      sessionId: session.id,
      pickerUrl: session.pickerUrl,
      nextPollAt: Date.now() + session.pollAfterMs,
      expiresAt: session.expiresAt,
      pollAfterMs: session.pollAfterMs,
    };
    await writePhotosConnection(connection);
    return publicStatus(connection, true);
  });
}
export function pollPhotos() {
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    if (!(await signedIn())) return { state: "unconfigured" } as const;
    if (connection.state === "disconnected") return connection;
    if (connection.expiresAt <= Date.now()) {
      await writePhotosConnection({ state: "disconnected" });
      return { state: "disconnected" } as const;
    }
    if (connection.state === "selecting") {
      if (Date.now() < connection.nextPollAt)
        return publicStatus(connection, true);
      const session = await getPickerSession(connection.sessionId);
      connection.nextPollAt = Date.now() + session.pollAfterMs;
      connection.expiresAt = session.expiresAt;
      connection.pollAfterMs = session.pollAfterMs;
      if (!session.mediaItemsSet) {
        await writePhotosConnection(connection);
        return publicStatus(connection, true);
      }
      const photos = await listPickerPhotos(connection.sessionId);
      const ready: PhotosConnection = {
        state: "ready",
        sessionId: connection.sessionId,
        pickerUrl: connection.pickerUrl,
        nextPollAt: Date.now() + MEDIA_INTERVAL,
        expiresAt: connection.expiresAt,
        photos,
        nextMediaPollAt: Date.now() + MEDIA_INTERVAL,
        mediaExpiresAt: Date.now() + MEDIA_INTERVAL,
      };
      await writePhotosConnection(ready);
      return publicStatus(ready, true);
    }
    if (Date.now() >= connection.nextMediaPollAt) {
      connection.nextMediaPollAt = Date.now() + MEDIA_INTERVAL;
      await writePhotosConnection(connection);
      connection.photos = await listPickerPhotos(connection.sessionId);
      connection.mediaExpiresAt = Date.now() + MEDIA_INTERVAL;
      await writePhotosConnection(connection);
    }
    return publicStatus(connection, true);
  });
}
export function disconnectPhotos() {
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    await writePhotosConnection({ state: "disconnected" });
    if (connection.state !== "disconnected") {
      try {
        await deletePickerSession(connection.sessionId);
      } catch {
        /* local disconnect remains authoritative */
      }
    }
    return { state: "disconnected" } as const;
  });
}
export function readPhoto(id: string) {
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    if (connection.state !== "ready" || connection.mediaExpiresAt <= Date.now())
      throw new Error("photo_unavailable");
    const photo = connection.photos.find((p) => p.id === id);
    if (!photo) throw new Error("photo_unavailable");
    try {
      const response = await fetchPhoto(photo.baseUrl);
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (
        !response.ok ||
        !mime?.startsWith("image/") ||
        mime === "image/svg+xml"
      )
        throw new Error("photo_unavailable");
      return new Response(response.body, {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new Error("photo_unavailable");
    }
  });
}
