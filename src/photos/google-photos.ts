import {
  googleUrl,
  type PhotoTokens,
  parseDevice,
  parsePhotos,
  positiveNumber,
  record,
  requiredString,
} from "./photos";

const API = "https://photosambient.googleapis.com/v1";
export const PHOTOS_SCOPE =
  "https://www.googleapis.com/auth/photosambient.mediaitems";

export class PhotosError extends Error {
  constructor(
    public code: string,
    public status = 502,
  ) {
    super(code);
  }
}

export function photosClient() {
  const id = process.env.GOOGLE_PHOTOS_CLIENT_ID;
  const secret = process.env.GOOGLE_PHOTOS_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

async function jsonResponse(response: Response) {
  const raw = record(await response.json());
  if (!response.ok) {
    const code =
      typeof raw.error === "string"
        ? raw.error
        : typeof raw.error === "object" && raw.error
          ? record(raw.error).status
          : undefined;
    throw new PhotosError(
      typeof code === "string" ? code : "google_unavailable",
      response.status,
    );
  }
  return raw;
}

async function oauth(endpoint: string, body: Record<string, string>) {
  return jsonResponse(
    await fetch(`https://oauth2.googleapis.com/${endpoint}`, {
      method: "POST",
      body: new URLSearchParams(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }),
  );
}

export async function beginAuthorization(clientId: string, requestId: string) {
  const raw = await oauth("device/code", {
    client_id: clientId,
    scope: PHOTOS_SCOPE,
    state: JSON.stringify({ requestId, displayName: "FamilyOS" }),
  });
  return {
    deviceCode: requiredString(raw.device_code),
    userCode: requiredString(raw.user_code),
    verificationUrl: googleUrl(raw.verification_url),
    expiresAt: Date.now() + positiveNumber(raw.expires_in) * 1000,
    intervalMs: Math.max(5000, positiveNumber(raw.interval ?? 5) * 1000),
  };
}

function tokens(
  raw: Record<string, unknown>,
  refreshToken?: string,
): PhotoTokens {
  if (
    typeof raw.scope === "string" &&
    !raw.scope.split(" ").includes(PHOTOS_SCOPE)
  )
    throw new PhotosError("missing_scope", 403);
  return {
    accessToken: requiredString(raw.access_token),
    refreshToken: requiredString(raw.refresh_token ?? refreshToken),
    expiresAt: Date.now() + positiveNumber(raw.expires_in) * 1000,
  };
}

export async function pollAuthorization(
  client: { id: string; secret: string },
  deviceCode: string,
) {
  return tokens(
    await oauth("token", {
      client_id: client.id,
      client_secret: client.secret,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  );
}

export async function refreshPhotosToken(
  client: { id: string; secret: string },
  refreshToken: string,
) {
  return tokens(
    await oauth("token", {
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    refreshToken,
  );
}

async function ambient(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
) {
  return jsonResponse(
    await fetch(`${API}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }),
  );
}

export async function createAmbientDevice(token: string, requestId: string) {
  try {
    return parseDevice(
      await ambient(
        `devices?requestId=${encodeURIComponent(requestId)}`,
        token,
        "POST",
        { displayName: "FamilyOS" },
      ),
    );
  } catch (error) {
    if (!(error instanceof PhotosError) || error.code !== "ALREADY_EXISTS")
      throw error;
    // The create response may have been lost. Google's documented recovery is
    // to delete the orphan by requestId and retry with the same receipt key.
    await deleteAmbientDevice(token, requestId);
    return parseDevice(
      await ambient(
        `devices?requestId=${encodeURIComponent(requestId)}`,
        token,
        "POST",
        { displayName: "FamilyOS" },
      ),
    );
  }
}

export async function getAmbientDevice(token: string, id: string) {
  return parseDevice(await ambient(`devices/${encodeURIComponent(id)}`, token));
}

export async function deleteAmbientDevice(token: string, id: string) {
  try {
    await ambient(`devices/${encodeURIComponent(id)}`, token, "DELETE");
  } catch (error) {
    if (!(error instanceof PhotosError) || error.status !== 404) throw error;
  }
}

export async function listAmbientPhotos(token: string, deviceId: string) {
  // Ambient mode provides a curated batch (maximum 100), not an incomplete
  // first page of an album. Google rotates the selection on subsequent reads.
  return parsePhotos(
    await ambient(
      `mediaItems?${new URLSearchParams({ deviceId, pageSize: "100" })}`,
      token,
    ),
  );
}

export async function fetchPhoto(token: string, baseUrl: string) {
  return fetch(`${googleUrl(baseUrl, true)}=w2560-h1440`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
}
