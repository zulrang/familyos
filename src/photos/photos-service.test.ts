import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readProvider, writeProvider } from "@/shared/provider";
import {
  connectPhotos,
  disconnectPhotos,
  getPhotosStatus,
  pollPhotos,
  readPhoto,
} from "./photos-service";
import {
  readPhotosConnection,
  withPhotosConnection,
  writePhotosConnection,
} from "./photos-store";

describe("Photos Picker connection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "familyos-picker-"));
    vi.stubEnv("FAMILYOS_DATA_DIR", dir);
    await writeProvider({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry: Date.now() + 600_000,
      },
      oauthState: null,
      providerConnectionId: "account",
    });
    expect((await readProvider()).tokens?.access_token).toBe("access");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  test("creates one Picker session and exposes only its picker URL", async () => {
    vi.stubGlobal("fetch", async (input: string) =>
      input.includes("sessions")
        ? Response.json({
            id: "session",
            pickerUri: "https://photos.google.com/picker",
            mediaItemsSet: false,
            pollingConfig: { pollInterval: "5s" },
            expireTime: "2030-01-01T00:00:00Z",
          })
        : Response.json({}),
    );
    expect(await connectPhotos()).toMatchObject({
      state: "selecting",
      pickerUrl: "https://photos.google.com/picker",
    });
    expect((await readPhotosConnection()).state).toBe("selecting");
  });

  test("polls a completed session and lists selected raster photos", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      if (input.endsWith("/sessions"))
        return Response.json({
          id: "session",
          pickerUri: "https://photos.google.com/picker",
          mediaItemsSet: false,
          pollingConfig: { pollInterval: "5s" },
          expireTime: "2030-01-01T00:00:00Z",
        });
      if (input.includes("/sessions/session"))
        return Response.json({
          id: "session",
          mediaItemsSet: true,
          expireTime: "2030-01-01T00:00:00Z",
        });
      return Response.json({
        mediaItems: [
          {
            id: "one",
            mediaFile: {
              mimeType: "image/jpeg",
              baseUrl: "https://lh3.googleusercontent.com/one",
            },
          },
          {
            id: "movie",
            mediaFile: {
              mimeType: "video/mp4",
              baseUrl: "https://lh3.googleusercontent.com/movie",
            },
          },
        ],
      });
    });
    await connectPhotos();
    const connection = await readPhotosConnection();
    if (connection.state === "selecting") {
      connection.nextPollAt = 0;
      await writePhotosConnection(connection);
    }
    expect(await pollPhotos()).toMatchObject({
      state: "ready",
      sourceName: "Selected Google Photos",
      photos: [{ id: "one" }],
    });
  });

  test("disconnect clears the session locally even if Google cleanup fails", async () => {
    await writePhotosConnection({
      state: "selecting",
      sessionId: "session",
      pickerUrl: "https://photos.google.com/picker",
      nextPollAt: 0,
      expiresAt: Date.now() + 10000,
      pollAfterMs: 5000,
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await disconnectPhotos()).toEqual({ state: "disconnected" });
    expect(await getPhotosStatus()).toEqual({ state: "disconnected" });
  });

  test("photo images are cacheable and read without blocking on the connection queue", async () => {
    await writePhotosConnection({
      state: "ready",
      sessionId: "session",
      pickerUrl: "https://photos.google.com/picker",
      nextPollAt: Date.now() + 600_000,
      expiresAt: Date.now() + 600_000,
      nextMediaPollAt: Date.now() + 600_000,
      mediaExpiresAt: Date.now() + 600_000,
      photos: [{ id: "one", baseUrl: "https://lh3.googleusercontent.com/one" }],
    });
    // A permanently pending operation occupies the queue for this test.
    void withPhotosConnection(() => new Promise(() => {}));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("jpeg", {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          }),
      ),
    );
    const response = await readPhoto("one");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3000");
    // If readPhoto were still serialized behind the queue, this await would
    // hang until the test timeout: the queued operation never resolves.
    expect(await response.text()).toBe("jpeg");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://lh3.googleusercontent.com/one=w1920-h1080",
      expect.anything(),
    );
  });
});
