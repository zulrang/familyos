import {
  beginAuthorization,
  createAmbientDevice,
  deleteAmbientDevice,
  fetchPhoto,
  getAmbientDevice,
  listAmbientPhotos,
  PhotosError,
  photosClient,
  pollAuthorization,
  refreshPhotosToken,
} from "./google-photos";
import type { PhotosConnection, PhotosStatus } from "./photos";
import {
  readPhotosConnection,
  withPhotosConnection,
  writePhotosConnection,
} from "./photos-store";

const MEDIA_INTERVAL = 10 * 60_000;
type Authorized = Extract<
  PhotosConnection,
  { state: "creating" | "connected" }
>;

async function freshTokens(connection: Authorized) {
  const client = photosClient();
  if (!client || connection.clientId !== client.id)
    throw new PhotosError("client_changed", 409);
  if (connection.tokens.expiresAt > Date.now() + 60_000) return;
  try {
    connection.tokens = await refreshPhotosToken(
      client,
      connection.tokens.refreshToken,
    );
    await writePhotosConnection(connection);
  } catch (error) {
    if (error instanceof PhotosError && error.code === "invalid_grant")
      await writePhotosConnection({ state: "disconnected" });
    throw error;
  }
}

function publicStatus(connection: PhotosConnection): PhotosStatus {
  if (!photosClient()) return { state: "unconfigured" };
  switch (connection.state) {
    case "disconnected":
      return connection;
    case "authorizing":
      return {
        state: "authorizing",
        userCode: connection.userCode,
        verificationUrl: connection.verificationUrl,
        expiresAt: connection.expiresAt,
        pollAfterMs: Math.max(1000, connection.nextPollAt - Date.now()),
      };
    case "creating":
      throw new PhotosError("device_creation_pending");
    case "connected": {
      const { device } = connection;
      if (!device.sourcesSet || device.sources.length !== 1)
        return {
          state: "selecting",
          settingsUrl: device.settingsUrl,
          pollAfterMs: device.pollAfterMs,
        };
      return {
        state: "ready",
        settingsUrl: device.settingsUrl,
        sourceName: device.sources[0].name,
        photos:
          Date.now() < connection.mediaExpiresAt
            ? connection.photos.map((p) => ({
                id: p.id,
                src: `/api/photos/image?id=${encodeURIComponent(p.id)}&v=${connection.mediaExpiresAt}`,
              }))
            : [],
        pollAfterMs: Math.max(
          5000,
          Math.min(connection.nextDevicePollAt, connection.nextMediaPollAt) -
            Date.now(),
        ),
      };
    }
  }
}

export function getPhotosStatus() {
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    if (
      connection.state !== "disconnected" &&
      photosClient()?.id !== connection.clientId
    )
      throw new PhotosError("client_changed", 409);
    return publicStatus(connection);
  });
}

export function connectPhotos() {
  return withPhotosConnection(async () => {
    const client = photosClient();
    if (!client) return { state: "unconfigured" } as const;
    const current = await readPhotosConnection();
    if (
      current.state !== "disconnected" &&
      !(current.state === "authorizing" && current.expiresAt <= Date.now())
    )
      return publicStatus(current);
    const requestId = crypto.randomUUID();
    const auth = await beginAuthorization(client.id, requestId);
    const connection: PhotosConnection = {
      state: "authorizing",
      clientId: client.id,
      requestId,
      ...auth,
      nextPollAt: Date.now() + auth.intervalMs,
    };
    await writePhotosConnection(connection);
    return publicStatus(connection);
  });
}

export function pollPhotos() {
  return withPhotosConnection(async () => {
    let connection = await readPhotosConnection();
    const client = photosClient();
    if (!client) return { state: "unconfigured" } as const;
    if (connection.state === "disconnected") return publicStatus(connection);
    if (connection.clientId !== client.id)
      throw new PhotosError("client_changed", 409);
    if (connection.state === "authorizing") {
      if (connection.expiresAt <= Date.now()) {
        await writePhotosConnection({ state: "disconnected" });
        throw new PhotosError("expired_token", 410);
      }
      if (Date.now() < connection.nextPollAt) return publicStatus(connection);
      connection.nextPollAt = Date.now() + connection.intervalMs;
      await writePhotosConnection(connection);
      try {
        const tokens = await pollAuthorization(client, connection.deviceCode);
        connection = {
          state: "creating",
          clientId: client.id,
          requestId: connection.requestId,
          tokens,
        };
        await writePhotosConnection(connection);
      } catch (error) {
        if (
          error instanceof PhotosError &&
          connection.state === "authorizing"
        ) {
          if (error.code === "slow_down") {
            connection.intervalMs += 5000;
            connection.nextPollAt = Date.now() + connection.intervalMs;
            await writePhotosConnection(connection);
          }
          if (
            error.code === "authorization_pending" ||
            error.code === "slow_down"
          )
            return publicStatus(connection);
          if (
            ["access_denied", "expired_token", "invalid_grant"].includes(
              error.code,
            )
          )
            await writePhotosConnection({ state: "disconnected" });
        }
        throw error;
      }
    }
    if (connection.state !== "creating" && connection.state !== "connected")
      return publicStatus(connection);
    await freshTokens(connection);
    if (connection.state === "creating") {
      const device = await createAmbientDevice(
        connection.tokens.accessToken,
        connection.requestId,
      );
      connection = {
        state: "connected",
        clientId: connection.clientId,
        tokens: connection.tokens,
        device,
        nextDevicePollAt: Date.now() + device.pollAfterMs,
        photos: [],
        nextMediaPollAt: 0,
        mediaExpiresAt: 0,
      };
      await writePhotosConnection(connection);
    }
    if (Date.now() >= connection.nextDevicePollAt) {
      connection.nextDevicePollAt =
        Date.now() + Math.max(connection.device.pollAfterMs, 30_000);
      await writePhotosConnection(connection);
      const device = await getAmbientDevice(
        connection.tokens.accessToken,
        connection.device.id,
      );
      if (
        !device.sourcesSet ||
        device.sources.length !== 1 ||
        device.sources[0].id !== connection.device.sources[0]?.id
      ) {
        connection.photos = [];
        connection.mediaExpiresAt = 0;
      }
      connection.device = device;
      connection.nextDevicePollAt =
        Date.now() +
        Math.max(
          device.pollAfterMs,
          device.sourcesSet && device.sources.length === 1 ? 60_000 : 5000,
        );
      await writePhotosConnection(connection);
    }
    if (
      connection.device.sourcesSet &&
      connection.device.sources.length === 1 &&
      Date.now() >= connection.nextMediaPollAt
    ) {
      connection.nextMediaPollAt = Date.now() + MEDIA_INTERVAL;
      await writePhotosConnection(connection);
      connection.photos = await listAmbientPhotos(
        connection.tokens.accessToken,
        connection.device.id,
      );
      connection.mediaExpiresAt = Date.now() + 50 * 60_000;
      await writePhotosConnection(connection);
    }
    return publicStatus(connection);
  });
}

export function disconnectPhotos() {
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    // Clear local access even if Google is unavailable. The Google account's
    // device settings remain the fallback for removing an unreachable device.
    await writePhotosConnection({ state: "disconnected" });
    if (
      (connection.state === "connected" || connection.state === "creating") &&
      photosClient()?.id === connection.clientId
    ) {
      try {
        const client = photosClient();
        if (!client) return { state: "disconnected" } as const;
        const token =
          connection.tokens.expiresAt > Date.now()
            ? connection.tokens
            : await refreshPhotosToken(client, connection.tokens.refreshToken);
        await deleteAmbientDevice(
          token.accessToken,
          connection.state === "connected"
            ? connection.device.id
            : connection.requestId,
        );
      } catch {
        /* Local credentials are already removed. */
      }
    }
    return { state: "disconnected" } as const;
  });
}

export function readPhoto(id: string) {
  return withPhotosConnection(async () => {
    const connection = await readPhotosConnection();
    if (
      connection.state !== "connected" ||
      connection.mediaExpiresAt <= Date.now() ||
      !connection.device.sourcesSet ||
      connection.device.sources.length !== 1
    )
      throw new PhotosError("photo_unavailable", 404);
    const photo = connection.photos.find((p) => p.id === id);
    if (!photo) throw new PhotosError("photo_unavailable", 404);
    await freshTokens(connection);
    const response = await fetchPhoto(
      connection.tokens.accessToken,
      photo.baseUrl,
    );
    const mime = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || !mime?.startsWith("image/") || mime === "image/svg+xml")
      throw new PhotosError("photo_unavailable", 502);
    return new Response(response.body, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
