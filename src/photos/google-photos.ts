import { gfetch, throwIfGoogleFailed } from "@/shared/google";

const API = "https://photospicker.googleapis.com/v1";

export class PhotosError extends Error {
  constructor(
    public code: string,
    public status = 502,
  ) {
    super(code);
  }
}

async function pickerFetch(
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await gfetch(`${API}/${path}`, init);
  } catch (error) {
    throw new PhotosError(
      error instanceof Error ? error.message : "google_auth",
      401,
    );
  }
  if (!response.ok) {
    const text = (await response.text()).slice(0, 400);
    let code = "google_unavailable";
    try {
      code =
        (JSON.parse(text) as { error?: { status?: string } }).error?.status ??
        code;
    } catch {
      /* generic */
    }
    throw new PhotosError(code, response.status);
  }
  if (response.status === 204) return {};
  const value: unknown = await response.json();
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type PickerSession = {
  id: string;
  pickerUrl: string;
  mediaItemsSet: boolean;
  pollAfterMs: number;
  expiresAt: number;
};

type PickerSessionStatus = Omit<PickerSession, "pickerUrl">;

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new PhotosError(`invalid_${name}`, 502);
  return value;
}

function parseDuration(value: unknown, fallbackMs: number): number {
  if (typeof value !== "string" || !/^\d+(\.\d+)?s$/.test(value))
    return fallbackMs;
  return Math.max(5000, Number.parseFloat(value) * 1000);
}

function parsePickerSessionStatus(
  raw: Record<string, unknown>,
): PickerSessionStatus {
  const polling =
    raw.pollingConfig && typeof raw.pollingConfig === "object"
      ? (raw.pollingConfig as Record<string, unknown>)
      : {};
  const expiry = Date.parse(
    typeof raw.expireTime === "string" ? raw.expireTime : "",
  );
  return {
    id: stringField(raw.id, "session"),
    mediaItemsSet: raw.mediaItemsSet === true,
    pollAfterMs: parseDuration(polling.pollInterval, 5000),
    expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + 30 * 60_000,
  };
}

export function parsePickerSession(
  raw: Record<string, unknown>,
): PickerSession {
  return {
    ...parsePickerSessionStatus(raw),
    pickerUrl: stringField(raw.pickerUri, "picker_url"),
  };
}

export async function createPickerSession(): Promise<PickerSession> {
  return parsePickerSession(
    await pickerFetch("sessions", {
      method: "POST",
      body: JSON.stringify({ pickingConfig: { maxItemCount: "2000" } }),
    }),
  );
}
export async function getPickerSession(
  sessionId: string,
): Promise<PickerSessionStatus> {
  return parsePickerSessionStatus(
    await pickerFetch(`sessions/${encodeURIComponent(sessionId)}`),
  );
}
export async function deletePickerSession(sessionId: string): Promise<void> {
  await pickerFetch(`sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
export async function listPickerPhotos(sessionId: string) {
  const photos: { id: string; baseUrl: string }[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const raw = await pickerFetch(`mediaItems?${query}`);
    if (Array.isArray(raw.mediaItems))
      photos.push(
        ...raw.mediaItems.flatMap((item: unknown) => {
          if (!item || typeof item !== "object") return [];
          const media = item as Record<string, unknown>;
          const file =
            media.mediaFile && typeof media.mediaFile === "object"
              ? (media.mediaFile as Record<string, unknown>)
              : media;
          const mime = typeof file.mimeType === "string" ? file.mimeType : "";
          const baseUrl = typeof file.baseUrl === "string" ? file.baseUrl : "";
          const id = typeof media.id === "string" ? media.id : "";
          if (
            !id ||
            !baseUrl ||
            !mime.startsWith("image/") ||
            mime === "image/svg+xml"
          )
            return [];
          return [{ id, baseUrl }];
        }),
      );
    if (typeof raw.nextPageToken !== "string" || !raw.nextPageToken) break;
    pageToken = raw.nextPageToken;
  }
  return photos;
}
export async function fetchPhoto(baseUrl: string) {
  const response = await gfetch(`${baseUrl}=w1920-h1080`);
  await throwIfGoogleFailed(response, "Google Photos image");
  return response;
}
