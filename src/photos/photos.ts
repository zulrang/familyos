export type Photo = { id: string; src: string };

export type PhotosStatus =
  | { state: "unconfigured" }
  | { state: "disconnected" }
  | {
      state: "authorizing";
      userCode: string;
      verificationUrl: string;
      expiresAt: number;
      pollAfterMs: number;
    }
  | { state: "selecting"; settingsUrl: string; pollAfterMs: number }
  | {
      state: "ready";
      settingsUrl: string;
      sourceName: string;
      photos: Photo[];
      pollAfterMs: number;
    };

export type PhotoTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
export type AmbientDevice = {
  id: string;
  settingsUrl: string;
  sources: { id: string; name: string }[];
  sourcesSet: boolean;
  pollAfterMs: number;
};
export type AmbientPhoto = { id: string; baseUrl: string };

export type PhotosConnection =
  | { state: "disconnected" }
  | {
      state: "authorizing";
      clientId: string;
      requestId: string;
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      expiresAt: number;
      intervalMs: number;
      nextPollAt: number;
    }
  | {
      state: "creating";
      clientId: string;
      requestId: string;
      tokens: PhotoTokens;
    }
  | {
      state: "connected";
      clientId: string;
      tokens: PhotoTokens;
      device: AmbientDevice;
      nextDevicePollAt: number;
      photos: AmbientPhoto[];
      nextMediaPollAt: number;
      mediaExpiresAt: number;
    };

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Google Photos response");
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new Error("Invalid Google Photos response");
  return value;
}

export function positiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error("Invalid Google Photos response");
  return value;
}

export function googleUrl(value: unknown, media = false): string {
  const url = new URL(requiredString(value));
  const host = media ? "googleusercontent.com" : "google.com";
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !(url.hostname === host || url.hostname.endsWith(`.${host}`))
  )
    throw new Error("Invalid Google Photos URL");
  return url.href;
}

export function parseDevice(value: unknown): AmbientDevice {
  const raw = record(value);
  const polling =
    raw.pollingConfig === undefined ? {} : record(raw.pollingConfig);
  const interval =
    typeof polling.pollInterval === "string" &&
    /^\d+(\.\d+)?s$/.test(polling.pollInterval)
      ? Number.parseFloat(polling.pollInterval) * 1000
      : 5000;
  if (raw.mediaSources !== undefined && !Array.isArray(raw.mediaSources))
    throw new Error("Invalid Google Photos sources");
  return {
    id: requiredString(raw.id),
    settingsUrl: googleUrl(raw.settingsUri),
    sourcesSet: raw.mediaSourcesSet === true,
    pollAfterMs: Math.max(5000, interval),
    sources: (raw.mediaSources ?? []).map((source: unknown) => {
      const s = record(source);
      return { id: requiredString(s.id), name: requiredString(s.displayName) };
    }),
  };
}

export function parsePhotos(value: unknown): AmbientPhoto[] {
  const raw = record(value);
  if (raw.mediaItems === undefined) return [];
  if (!Array.isArray(raw.mediaItems))
    throw new Error("Invalid Google Photos media");
  return raw.mediaItems.flatMap((item: unknown) => {
    const m = record(item);
    const file = record(m.mediaFile);
    if (
      typeof file.mimeType !== "string" ||
      !file.mimeType.startsWith("image/") ||
      file.mimeType === "image/svg+xml"
    )
      return [];
    return [
      { id: requiredString(m.id), baseUrl: googleUrl(file.baseUrl, true) },
    ];
  });
}
