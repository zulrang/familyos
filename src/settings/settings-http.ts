import { readHousehold, updateHousehold } from "@/settings/settings";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { googleConfigured } from "@/shared/google-env";
import { setDisplayUiScale } from "@/shared/pairing";
import { readProvider } from "@/shared/provider";
import { parseUiScale, type UiScale } from "@/shared/ui-scale";

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
    timeZone: s.timeZone,
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
    members?: unknown;
    calendarId?: string | null;
    listIds?: unknown;
    timeZone?: unknown;
    uiScale?: unknown;
    expectedVersion?: unknown;
  };

  const touchesHousehold =
    body.familyName !== undefined ||
    body.members !== undefined ||
    body.calendarId !== undefined ||
    body.listIds !== undefined ||
    body.timeZone !== undefined;

  let uiScale = display.uiScale;
  const provider = await readProvider();

  if (touchesHousehold) {
    const current = await readHousehold();
    let calendarTimeZone = current.calendarTimeZone;
    const calendarId =
      body.calendarId === undefined ? current.calendarId : body.calendarId;
    if (calendarId && calendarId !== current.calendarId && provider.tokens) {
      try {
        // DESIGN-DEVIATION: settings applies Household calendarId and needs the
        // provider timezone; calendar owns listCalendars. Extract a shared
        // calendar-meta port if a third caller appears.
        const { listCalendars } = await import("@/calendar/google-events");
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
      timeZone:
        body.timeZone === undefined
          ? undefined
          : typeof body.timeZone === "string"
            ? body.timeZone
            : "",
    });
    if (!result.ok) {
      if (result.reason === "roster") {
        return Response.json({ error: result.error }, { status: 400 });
      }
      if (result.reason === "timeZone") {
        return Response.json({ error: "invalid time zone" }, { status: 400 });
      }
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
