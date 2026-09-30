import { AuthError } from "@/shared/auth-error";
import { readProvider } from "@/shared/provider";
import {
  createPickerSession,
  deletePickerSession,
  fetchPhoto,
  getPickerSession,
  listPickerPhotos,
  PhotosError,
  type PhotosTransportCode,
} from "./google-photos";
import type { PhotosConnection, PhotosStatus } from "./photos";
import {
  readPhotosConnection,
  withPhotosConnection,
  writePhotosConnection,
} from "./photos-store";

const MEDIA_INTERVAL = 50 * 60_000;
const MEDIA_RETRY_INTERVAL = 60_000;
const DIAGNOSTIC_INTERVAL = 60 * 60_000;
const lastDiagnostic = new Map<string, number>();
let pollCount = 0;
let lastPollReceivedAt: string | null = null;

type FailureDetail =
  | { failure: "auth" | "unexpected" }
  | { failure: "transport"; transportCode: PhotosTransportCode }
  | { failure: "provider_http" | "invalid_response"; status: number };
type PhotoDiagnostic =
  | { event: "poll_received"; pollCount: number }
  | {
      event: "expired_status" | "expired_image";
      overdueMs: number;
      refreshOverdueMs: number;
      photoCount: number;
      pollCount: number;
      lastPollReceivedAt: string | null;
    }
  | { event: "media_refresh_started"; overdueMs: number; photoCount: number }
  | { event: "media_refresh_succeeded"; durationMs: number; photoCount: number }
  | ({ event: "media_refresh_failed"; durationMs: number } & FailureDetail)
  | ({ event: "image_fetch_failed" } & FailureDetail)
  | ({
      event: "request_failed";
      operation: "status" | "connect" | "poll" | "disconnect";
    } & FailureDetail);

function diagnostic(details: PhotoDiagnostic, interval = 0) {
  const now = Date.now();
  const last = lastDiagnostic.get(details.event);
  if (interval && last !== undefined && now - last < interval) return;
  lastDiagnostic.set(details.event, now);
  console.info("[photos]", { at: new Date(now).toISOString(), ...details });
}

function failureDetails(error: unknown): FailureDetail {
  if (error instanceof AuthError) return { failure: "auth" };
  if (error instanceof PhotosError) {
    if (error.code === "google_transport")
      return {
        failure: "transport",
        transportCode: error.transport ?? "unknown",
      };
    if (error.code.startsWith("invalid_"))
      return { failure: "invalid_response", status: error.status };
    return { failure: "provider_http", status: error.status };
  }
  return { failure: "unexpected" };
}
export function logPhotosRequestFailure(
  operation: "status" | "connect" | "poll" | "disconnect",
  error: unknown,
) {
  diagnostic(
    { event: "request_failed", operation, ...failureDetails(error) },
    60_000,
  );
}
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
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    if (connection.state === "ready" && Date.now() >= connection.mediaExpiresAt)
      diagnostic(
        {
          event: "expired_status",
          overdueMs: Date.now() - connection.mediaExpiresAt,
          refreshOverdueMs: Date.now() - connection.nextMediaPollAt,
          photoCount: connection.photos.length,
          pollCount,
          lastPollReceivedAt,
        },
        DIAGNOSTIC_INTERVAL,
      );
    return publicStatus(connection, await signedIn());
  });
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
  pollCount += 1;
  lastPollReceivedAt = new Date().toISOString();
  diagnostic({ event: "poll_received", pollCount }, DIAGNOSTIC_INTERVAL);
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
      const startedAt = Date.now();
      diagnostic({
        event: "media_refresh_started",
        overdueMs: startedAt - connection.nextMediaPollAt,
        photoCount: connection.photos.length,
      });
      connection.nextMediaPollAt = Date.now() + MEDIA_INTERVAL;
      await writePhotosConnection(connection);
      try {
        connection.photos = await listPickerPhotos(connection.sessionId);
        connection.mediaExpiresAt = Date.now() + MEDIA_INTERVAL;
        await writePhotosConnection(connection);
        diagnostic({
          event: "media_refresh_succeeded",
          durationMs: Date.now() - startedAt,
          photoCount: connection.photos.length,
        });
      } catch (error) {
        connection.nextMediaPollAt = Date.now() + MEDIA_RETRY_INTERVAL;
        await writePhotosConnection(connection);
        diagnostic({
          event: "media_refresh_failed",
          durationMs: Date.now() - startedAt,
          ...failureDetails(error),
        });
        throw error;
      }
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
  // Read-only: does not mutate the connection file, so it skips the
  // write-serialization queue that status polls and media refreshes share.
  return (async () => {
    const connection = await readPhotosConnection();
    if (
      connection.state !== "ready" ||
      connection.mediaExpiresAt <= Date.now()
    ) {
      if (connection.state === "ready")
        diagnostic(
          {
            event: "expired_image",
            overdueMs: Date.now() - connection.mediaExpiresAt,
            refreshOverdueMs: Date.now() - connection.nextMediaPollAt,
            photoCount: connection.photos.length,
            pollCount,
            lastPollReceivedAt,
          },
          DIAGNOSTIC_INTERVAL,
        );
      throw new Error("photo_unavailable");
    }
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
          // v= in the URL is mediaExpiresAt, stable until the next media
          // refresh (~50 min), so the wall Chromium cache can hold photos.
          "Cache-Control": "private, max-age=3000",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      diagnostic(
        { event: "image_fetch_failed", ...failureDetails(error) },
        DIAGNOSTIC_INTERVAL,
      );
      if (error instanceof AuthError) throw error;
      throw new Error("photo_unavailable");
    }
  })();
}
