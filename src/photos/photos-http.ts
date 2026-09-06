import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { publicOrigin } from "@/shared/google-env";
import { PhotosError } from "./google-photos";
import {
  connectPhotos,
  disconnectPhotos,
  getPhotosStatus,
  pollPhotos,
  readPhoto,
} from "./photos-service";

const MESSAGES: Record<string, string> = {
  invalid_client:
    "Google Photos credentials need a TVs and Limited Input devices OAuth client.",
  invalid_scope:
    "Google has not enabled the Photos Ambient permission for this OAuth client. Check the project's Ambient API access.",
  PERMISSION_DENIED:
    "Google denied Ambient API access. Check the project's partner access and Google Photos permission.",
  access_denied:
    "Google Photos access was declined. Connect again to try another account.",
  expired_token: "The sign-in code expired. Connect Google Photos again.",
  invalid_grant: "Google Photos authorization expired. Connect again.",
  missing_scope: "Google Photos permission was not granted. Connect again.",
  client_changed:
    "Google Photos credentials changed. Disconnect Photos, then connect again.",
  RESOURCE_EXHAUSTED:
    "Google Photos is temporarily at its request limit. Try again later.",
  device_creation_pending:
    "Google Photos setup is unfinished. Retry to continue.",
  photo_unavailable:
    "This photo is unavailable. The slideshow will refresh automatically.",
};

function failure(error: unknown) {
  const code = error instanceof PhotosError ? error.code : "unavailable";
  return Response.json(
    {
      error:
        MESSAGES[code] ?? "Google Photos is unavailable. Try again shortly.",
    },
    {
      status:
        error instanceof PhotosError &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function handlePhotos(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== publicOrigin(request))
      return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    let result: unknown;
    if (request.method === "GET") result = await getPhotosStatus();
    else if (request.method === "DELETE") result = await disconnectPhotos();
    else if (request.method === "POST") {
      const raw: unknown = await request.json().catch(() => null);
      if (
        !raw ||
        typeof raw !== "object" ||
        !("action" in raw) ||
        (raw.action !== "connect" && raw.action !== "poll")
      )
        return Response.json(
          { error: "Invalid photo action" },
          { status: 400 },
        );
      result =
        raw.action === "connect" ? await connectPhotos() : await pollPhotos();
    } else return new Response(null, { status: 405 });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function handlePhotoImage(request: Request) {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 1024) return new Response(null, { status: 400 });
  try {
    return await readPhoto(id);
  } catch (error) {
    return failure(error);
  }
}
