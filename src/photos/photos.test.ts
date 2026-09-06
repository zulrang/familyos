import { describe, expect, test } from "vitest";
import { googleUrl, parseDevice, parsePhotos } from "./photos";

describe("Google Photos response boundary", () => {
  test("keeps only raster photos and validates media URLs", () => {
    expect(
      parsePhotos({
        mediaItems: [
          {
            id: "one",
            mediaFile: {
              mimeType: "image/jpeg",
              baseUrl: "https://lh3.googleusercontent.com/one",
            },
          },
          { id: "movie", mediaFile: { mimeType: "video/mp4" } },
          { id: "svg", mediaFile: { mimeType: "image/svg+xml" } },
        ],
      }),
    ).toEqual([
      { id: "one", baseUrl: "https://lh3.googleusercontent.com/one" },
    ]);
    expect(() =>
      parsePhotos({
        mediaItems: [
          {
            id: "bad",
            mediaFile: {
              mimeType: "image/jpeg",
              baseUrl: "https://example.com/private",
            },
          },
        ],
      }),
    ).toThrow();
  });

  test.each([
    "http://lh3.googleusercontent.com/a",
    "https://googleusercontent.com.evil.test/a",
    "https://user:pass@lh3.googleusercontent.com/a",
    "https://localhost/a",
    "https://lh3.googleusercontent.com:444/a",
  ])("rejects unsafe media URL %s", (url) => {
    expect(() => googleUrl(url, true)).toThrow();
  });

  test("preserves selected sources and Google's polling interval", () => {
    expect(
      parseDevice({
        id: "device",
        settingsUri: "https://photos.google.com/device",
        mediaSourcesSet: true,
        mediaSources: [{ id: "album", displayName: "Family" }],
        pollingConfig: { pollInterval: "12.5s" },
      }),
    ).toEqual({
      id: "device",
      settingsUrl: "https://photos.google.com/device",
      sourcesSet: true,
      sources: [{ id: "album", name: "Family" }],
      pollAfterMs: 12500,
    });
    expect(
      parseDevice({
        id: "device",
        settingsUri: "https://photos.google.com/device",
      }).sourcesSet,
    ).toBe(false);
  });
});
