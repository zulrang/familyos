import { isUnauthorized, requireTrustedDisplay } from "./display-auth.ts";
import { setDisplayUiScale } from "./pairing.ts";
import { readProvider } from "./provider.ts";
import {
  googleConfigured,
  readHousehold,
  updateHousehold,
} from "./settings.ts";
import { type Member, parseUiScale, type UiScale } from "./types.ts";

function publicSettings(
  s: Awaited<ReturnType<typeof readHousehold>>,
  signedIn: boolean,
  uiScale: UiScale,
) {
  return {
    familyName: s.familyName,
    members: s.members,
    calendarId: s.calendarId,
    listIds: s.listIds,
    signedIn,
    googleConfigured: googleConfigured(),
    uiScale,
    configVersion: s.configVersion,
  };
}

async function publicFromStores(uiScale: UiScale) {
  const [household, provider] = await Promise.all([
    readHousehold(),
    readProvider(),
  ]);
  return publicSettings(
    household,
    Boolean(provider.tokens?.access_token),
    uiScale,
  );
}

export async function handleGetSettings(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  return Response.json(await publicFromStores(display.uiScale));
}

export async function handlePatchSettings(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const body = (await request.json()) as {
    familyName?: string;
    members?: Member[];
    calendarId?: string | null;
    listIds?: unknown;
    uiScale?: unknown;
    expectedVersion?: unknown;
  };

  const touchesHousehold =
    body.familyName !== undefined ||
    body.members !== undefined ||
    body.calendarId !== undefined ||
    body.listIds !== undefined;

  let uiScale = display.uiScale;
  const provider = await readProvider();

  if (touchesHousehold) {
    const current = await readHousehold();
    let calendarTimeZone = current.calendarTimeZone;
    const calendarId =
      body.calendarId === undefined ? current.calendarId : body.calendarId;
    if (calendarId && calendarId !== current.calendarId && provider.tokens) {
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
    const result = await updateHousehold(body.expectedVersion, {
      familyName: body.familyName,
      members: body.members,
      calendarId,
      calendarTimeZone,
      listIds: body.listIds,
    });
    if (!result.ok) {
      return Response.json(
        publicSettings(
          result.config,
          Boolean(provider.tokens?.access_token),
          uiScale,
        ),
        { status: 409 },
      );
    }
  }

  if (body.uiScale !== undefined) {
    uiScale = parseUiScale(body.uiScale, display.uiScale);
    const ok = await setDisplayUiScale(display.id, uiScale);
    if (!ok) {
      return Response.json({ error: "display missing" }, { status: 404 });
    }
  }

  return Response.json(await publicFromStores(uiScale));
}
