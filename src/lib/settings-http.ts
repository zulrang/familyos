import { isUnauthorized, requireTrustedDisplay } from "./display-auth.ts";
import { setDisplayUiScale } from "./pairing.ts";
import { googleConfigured, patchSettings, readSettings } from "./settings.ts";
import { type Member, parseUiScale, type UiScale } from "./types.ts";

function publicSettings(
  s: Awaited<ReturnType<typeof readSettings>>,
  uiScale: UiScale,
) {
  return {
    familyName: s.familyName,
    members: s.members,
    calendarId: s.calendarId,
    signedIn: Boolean(s.tokens?.access_token),
    googleConfigured: googleConfigured(),
    uiScale,
  };
}

export async function handleGetSettings(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  return Response.json(publicSettings(await readSettings(), display.uiScale));
}

export async function handlePatchSettings(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const body = (await request.json()) as {
    familyName?: string;
    members?: Member[];
    calendarId?: string | null;
    uiScale?: unknown;
  };

  const touchesHousehold =
    body.familyName !== undefined ||
    body.members !== undefined ||
    body.calendarId !== undefined;

  let settings = await readSettings();
  let uiScale = display.uiScale;

  if (touchesHousehold) {
    let calendarTimeZone = settings.calendarTimeZone;
    const calendarId =
      body.calendarId === undefined ? settings.calendarId : body.calendarId;
    if (calendarId && calendarId !== settings.calendarId && settings.tokens) {
      try {
        // ponytail: dynamic import so Node self-checks never load Google; static once checks can mock it.
        const { listCalendars } = await import("./google.ts");
        const list = await listCalendars();
        calendarTimeZone =
          list.find((c) => c.id === calendarId)?.timeZone ?? calendarTimeZone;
      } catch {
        /* keep existing tz */
      }
    }
    settings = await patchSettings({
      familyName:
        typeof body.familyName === "string"
          ? body.familyName
          : settings.familyName,
      members: Array.isArray(body.members) ? body.members : settings.members,
      calendarId,
      calendarTimeZone,
    });
  }

  if (body.uiScale !== undefined) {
    uiScale = parseUiScale(body.uiScale, display.uiScale);
    const ok = await setDisplayUiScale(display.id, uiScale);
    if (!ok) {
      return Response.json({ error: "display missing" }, { status: 404 });
    }
  }

  return Response.json(publicSettings(settings, uiScale));
}
