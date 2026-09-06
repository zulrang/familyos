import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DISPLAY_COOKIE,
  emitStartupPairingCode,
  pairWithCode,
} from "@/shared/pairing";
import type { PhotosConnection } from "./photos";
import { handlePhotoImage, handlePhotos } from "./photos-http";
import {
  connectPhotos,
  disconnectPhotos,
  getPhotosStatus,
  pollPhotos,
  readPhoto,
} from "./photos-service";
import { readPhotosConnection, writePhotosConnection } from "./photos-store";

const connected = (): Extract<PhotosConnection, { state: "connected" }> => ({
  state: "connected",
  clientId: "photos-client",
  tokens: {
    accessToken: "private-access",
    refreshToken: "private-refresh",
    expiresAt: Date.now() + 3600_000,
  },
  device: {
    id: "device",
    settingsUrl: "https://photos.google.com/device",
    sourcesSet: true,
    sources: [{ id: "album", name: "Family" }],
    pollAfterMs: 5000,
  },
  nextDevicePollAt: Date.now() + 60_000,
  nextMediaPollAt: 0,
  photos: [],
  mediaExpiresAt: 0,
});

describe("Photos connection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "familyos-photos-"));
    vi.stubEnv("FAMILYOS_DATA_DIR", dir);
    vi.stubEnv("GOOGLE_PHOTOS_CLIENT_ID", "photos-client");
    vi.stubEnv("GOOGLE_PHOTOS_CLIENT_SECRET", "photos-secret");
    vi.stubGlobal("fetch", async () => {
      throw new Error("Unexpected network request");
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  test.each<Record<string, string>>([
    { origin: "http://192.168.1.20:3000", host: "192.168.1.20:3000" },
    {
      origin: "https://familyos.example",
      host: "localhost:3000",
      "x-forwarded-host": "familyos.example",
      "x-forwarded-proto": "https",
    },
  ])("accepts the browser origin when Next uses an internal URL: $origin", async (headers) => {
    const code = await emitStartupPairingCode();
    const paired = await pairWithCode(code ?? "");
    if (!paired.ok) throw new Error("Test pairing failed");
    const response = await handlePhotos(
      new Request("http://localhost:3000/api/photos", {
        method: "POST",
        headers: {
          ...headers,
          cookie: `${DISPLAY_COOKIE}=${paired.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "poll" }),
      }),
    );
    expect(await response.json()).toEqual({ state: "disconnected" });
    expect(response.status).toBe(200);
  });

  test("rejects another site's origin even on a paired Display", async () => {
    const code = await emitStartupPairingCode();
    const paired = await pairWithCode(code ?? "");
    if (!paired.ok) throw new Error("Test pairing failed");
    const response = await handlePhotos(
      new Request("http://localhost:3000/api/photos", {
        method: "POST",
        headers: {
          host: "192.168.1.20:3000",
          origin: "https://another.example",
          cookie: `${DISPLAY_COOKIE}=${paired.token}`,
        },
        body: JSON.stringify({ action: "poll" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid origin" });
  });

  test("unpaired requests cannot start authorization or access images", async () => {
    for (const method of ["GET", "POST", "DELETE"])
      expect(
        (
          await handlePhotos(
            new Request("http://familyos.test/api/photos", { method }),
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await handlePhotoImage(
          new Request("http://familyos.test/api/photos/image?id=secret"),
        )
      ).status,
    ).toBe(401);
  });

  test("connect is idempotent and never exposes the device code or credentials", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", async () => {
      requests++;
      return Response.json({
        device_code: "private-device",
        user_code: "ABCD-EFGH",
        verification_url: "https://www.google.com/device",
        expires_in: 1800,
        interval: 5,
      });
    });
    const status = await connectPhotos();
    expect(status.state).toBe("authorizing");
    expect(await connectPhotos()).toMatchObject({
      state: "authorizing",
      userCode: "ABCD-EFGH",
    });
    expect(requests).toBe(1); // The external creation effect must occur once.
    expect(JSON.stringify(status)).not.toContain("private");
    expect(await readPhotosConnection()).toMatchObject({
      deviceCode: "private-device",
    });
    expect(await pollPhotos()).toMatchObject({ state: "authorizing" });
    expect(requests).toBe(1); // Polling before Google's deadline must not call Google.
  });

  test("slow_down increases the poll interval and expired codes disconnect", async () => {
    const pending: PhotosConnection = {
      state: "authorizing",
      clientId: "photos-client",
      requestId: crypto.randomUUID(),
      deviceCode: "private",
      userCode: "CODE",
      verificationUrl: "https://www.google.com/device",
      expiresAt: Date.now() + 300_000,
      intervalMs: 5000,
      nextPollAt: 0,
    };
    await writePhotosConnection(pending);
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "slow_down" }, { status: 403 }),
    );
    expect(await pollPhotos()).toMatchObject({ state: "authorizing" });
    expect(await readPhotosConnection()).toMatchObject({ intervalMs: 10000 });
    await writePhotosConnection({ ...pending, expiresAt: 1 });
    await expect(pollPhotos()).rejects.toMatchObject({ code: "expired_token" });
    expect(await getPhotosStatus()).toEqual({ state: "disconnected" });
  });

  test("authorization persists tokens, creates a device and waits for album selection", async () => {
    await writePhotosConnection({
      state: "authorizing",
      clientId: "photos-client",
      requestId: crypto.randomUUID(),
      deviceCode: "private",
      userCode: "CODE",
      verificationUrl: "https://www.google.com/device",
      expiresAt: Date.now() + 300_000,
      intervalMs: 5000,
      nextPollAt: 0,
    });
    vi.stubGlobal("fetch", async (input: string) =>
      input.includes("oauth2")
        ? Response.json({
            access_token: "private-access",
            refresh_token: "private-refresh",
            expires_in: 3600,
          })
        : Response.json({
            id: "device",
            settingsUri: "https://photos.google.com/device",
            mediaSourcesSet: false,
          }),
    );
    expect(await pollPhotos()).toMatchObject({
      state: "selecting",
      settingsUrl: "https://photos.google.com/device",
    });
    expect(await readPhotosConnection()).toMatchObject({
      state: "connected",
      tokens: { refreshToken: "private-refresh" },
    });
  });

  test("concurrent Displays reuse one media batch and public responses hide Google URLs", async () => {
    await writePhotosConnection(connected());
    let requests = 0;
    vi.stubGlobal("fetch", async () => {
      requests++;
      return Response.json({
        mediaItems: [
          {
            id: "one",
            mediaFile: {
              mimeType: "image/jpeg",
              baseUrl: "https://lh3.googleusercontent.com/private",
            },
          },
        ],
      });
    });
    const statuses = await Promise.all([
      pollPhotos(),
      pollPhotos(),
      pollPhotos(),
    ]);
    expect(requests).toBe(1); // Shared quota is the observable guarantee.
    expect(statuses[0]).toMatchObject({
      state: "ready",
      photos: [{ id: "one" }],
    });
    expect(JSON.stringify(statuses)).not.toMatch(/private|googleusercontent/);
  });

  test("changing or removing the selected source drops previous photos", async () => {
    await writePhotosConnection({
      ...connected(),
      nextDevicePollAt: 0,
      photos: [{ id: "old", baseUrl: "https://lh3.googleusercontent.com/old" }],
      mediaExpiresAt: Date.now() + 3600_000,
      nextMediaPollAt: Date.now() + 600_000,
    });
    vi.stubGlobal("fetch", async () =>
      Response.json({
        id: "device",
        settingsUri: "https://photos.google.com/device",
        mediaSourcesSet: true,
        mediaSources: [{ id: "new", displayName: "New album" }],
      }),
    );
    expect(await pollPhotos()).toMatchObject({
      state: "ready",
      sourceName: "New album",
      photos: [],
    });
    await expect(readPhoto("old")).rejects.toMatchObject({
      code: "photo_unavailable",
    });
  });

  test("multiple selected albums cannot be displayed", async () => {
    const connection = connected();
    connection.device.sources.push({ id: "second", name: "Second" });
    await writePhotosConnection(connection);
    expect(await pollPhotos()).toMatchObject({ state: "selecting" });
  });

  test("invalid refresh grant removes expired credentials", async () => {
    const connection = connected();
    connection.tokens.expiresAt = 1;
    await writePhotosConnection(connection);
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(pollPhotos()).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await readPhotosConnection()).toEqual({ state: "disconnected" });
  });

  test("disconnect clears local access even when Google is unavailable", async () => {
    await writePhotosConnection(connected());
    expect(await disconnectPhotos()).toEqual({ state: "disconnected" });
    expect(await readPhotosConnection()).toEqual({ state: "disconnected" });
    await expect(readPhoto("one")).rejects.toMatchObject({
      code: "photo_unavailable",
    });
  });

  test("changing OAuth clients never exposes the old connection", async () => {
    await writePhotosConnection(connected());
    vi.stubEnv("GOOGLE_PHOTOS_CLIENT_ID", "different-client");
    await expect(getPhotosStatus()).rejects.toMatchObject({
      code: "client_changed",
    });
  });
});
