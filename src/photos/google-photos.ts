import { AuthError } from "@/shared/auth-error";
import { gfetch } from "@/shared/google";

const API = "https://photospicker.googleapis.com/v1";

export type PhotosTransportCode =
  | "timeout"
  | "ECONNRESET"
  | "ENOTFOUND"
  | "ETIMEDOUT"
  | "UND_ERR_CONNECT_TIMEOUT"
  | "UND_ERR_HEADERS_TIMEOUT"
  | "UND_ERR_BODY_TIMEOUT"
  | "unknown";

function transportCode(error: unknown): PhotosTransportCode {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  )
    return "timeout";
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const code =
    cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  switch (code) {
    case "ECONNRESET":
    case "ENOTFOUND":
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return code;
    default:
      return "unknown";
  }
}

export class PhotosError extends Error {
  constructor(
    public code: string,
    public status = 502,
    public transport: PhotosTransportCode | null = null,
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
    if (error instanceof AuthError) throw error;
    throw new PhotosError("google_transport", 502, transportCode(error));
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
  let response: Response;
  try {
    response = await gfetch(`${baseUrl}=w1920-h1080`);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new PhotosError("google_transport", 502, transportCode(error));
  }
  if (!response.ok) {
    // Body release is best effort; retain the upstream HTTP status on failure.
    await response.body?.cancel().catch(() => {});
    throw new PhotosError("image_http", response.status);
  }
  return response;
}
