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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
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

  test("failed media refresh records a safe cause and retries after one minute", async () => {
    const now = Date.now();
    await writePhotosConnection({
      state: "ready",
      sessionId: "private-session",
      pickerUrl: "https://photos.google.com/private-picker",
      nextPollAt: now - 1,
      expiresAt: now + 600_000,
      nextMediaPollAt: now - 1,
      mediaExpiresAt: now - 1,
      photos: [
        { id: "private-photo", baseUrl: "https://private-photo.example" },
      ],
    });
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new TypeError(
        "network failed at https://private-photo.example?token=secret",
        {
          cause: Object.assign(new Error("private cause"), {
            code: "ECONNRESET",
          }),
        },
      );
    });

    await expect(pollPhotos()).rejects.toThrow("google_transport");
    const connection = await readPhotosConnection();
    expect(connection.state).toBe("ready");
    if (connection.state !== "ready") return;
    expect(connection.nextMediaPollAt).toBeGreaterThanOrEqual(now + 59_000);
    expect(connection.nextMediaPollAt).toBeLessThanOrEqual(now + 61_000);
    expect(connection.photos).toHaveLength(1);
    const diagnostics = JSON.stringify(logs.mock.calls);
    expect(diagnostics).toContain("media_refresh_started");
    expect(diagnostics).toContain("media_refresh_failed");
    expect(diagnostics).toContain('"transportCode":"ECONNRESET"');
    expect(diagnostics).not.toContain("private-photo");
    expect(diagnostics).not.toContain("secret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(connection.nextMediaPollAt);
    vi.stubGlobal("fetch", async () =>
      Response.json({
        mediaItems: [
          {
            id: "new-photo",
            mediaFile: {
              mimeType: "image/jpeg",
              baseUrl: "https://new-photo.example",
            },
          },
        ],
      }),
    );
    expect(await pollPhotos()).toMatchObject({
      state: "ready",
      photos: [{ id: "new-photo" }],
    });
  });

  test("expired reads emit bounded diagnostics without stored photo details", async () => {
    const now = Date.now();
    await writePhotosConnection({
      state: "ready",
      sessionId: "private-session",
      pickerUrl: "https://photos.google.com/private-picker",
      nextPollAt: now - 1000,
      expiresAt: now + 600_000,
      nextMediaPollAt: now - 1000,
      mediaExpiresAt: now - 1000,
      photos: [
        { id: "private-photo", baseUrl: "https://private-photo.example" },
      ],
    });
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await getPhotosStatus()).toMatchObject({
      state: "ready",
      photos: [],
    });
    expect(await getPhotosStatus()).toMatchObject({
      state: "ready",
      photos: [],
    });
    await expect(readPhoto("private-photo")).rejects.toThrow(
      "photo_unavailable",
    );
    await expect(readPhoto("private-photo")).rejects.toThrow(
      "photo_unavailable",
    );
    const diagnostics = JSON.stringify(logs.mock.calls);
    expect(
      logs.mock.calls.filter(([, record]) => record.event === "expired_status"),
    ).toHaveLength(1);
    expect(
      logs.mock.calls.filter(([, record]) => record.event === "expired_image"),
    ).toHaveLength(1);
    expect(diagnostics).toContain("lastPollReceivedAt");
    expect(diagnostics).not.toContain("private-photo");
    expect(diagnostics).not.toContain("private-picker");
  });

  test("image fetch logs a safe upstream HTTP status", async () => {
    const now = Date.now();
    await writePhotosConnection({
      state: "ready",
      sessionId: "private-session",
      pickerUrl: "https://photos.google.com/private-picker",
      nextPollAt: now + 600_000,
      expiresAt: now + 600_000,
      nextMediaPollAt: now + 600_000,
      mediaExpiresAt: now + 600_000,
      photos: [
        { id: "private-photo", baseUrl: "https://private-photo.example" },
      ],
    });
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    let bodyCancelled = false;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          }),
          { status: 429 },
        ),
    );
    await expect(readPhoto("private-photo")).rejects.toThrow(
      "photo_unavailable",
    );
    expect(bodyCancelled).toBe(true);
    const diagnostics = JSON.stringify(logs.mock.calls);
    expect(diagnostics).toContain('"failure":"provider_http"');
    expect(diagnostics).toContain('"status":429');
    expect(diagnostics).not.toContain("secret body");
    expect(diagnostics).not.toContain("private-photo");
  });
});
