import { type HouseholdMember, parseRoster } from "@/members/members";
import {
  parseListIds,
  readHousehold,
  updateHousehold,
} from "@/settings/settings";
import type { HouseholdListId } from "@/settings/types";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";
import { googleConfigured } from "@/shared/google-env";
import {
  type IdleDimAfterMs,
  type IdleDimTo,
  parseIdleDimAfterMs,
  parseIdleDimTo,
} from "@/shared/idle-dim";
import { setDisplayIdleDim, setDisplayUiScale } from "@/shared/pairing";
import { readProvider } from "@/shared/provider";
import { isIanaTimeZone } from "@/shared/time";
import { parseUiScale, type UiScale } from "@/shared/ui-scale";

type DisplayConfig = {
  uiScale: UiScale;
  idleDimAfterMs: IdleDimAfterMs;
  idleDimTo: IdleDimTo;
};

function publicSettings(
  s: Awaited<ReturnType<typeof readHousehold>>,
  signedIn: boolean,
  display: DisplayConfig,
) {
  return {
    familyName: s.familyName,
    members: s.members,
    calendarId: s.calendarId,
    listIds: s.listIds,
    timeZone: s.timeZone,
    signedIn,
    googleConfigured: googleConfigured(),
    uiScale: display.uiScale,
    idleDimAfterMs: display.idleDimAfterMs,
    idleDimTo: display.idleDimTo,
    configVersion: s.configVersion,
  };
}

async function publicFromStores(display: DisplayConfig) {
  const [household, provider] = await Promise.all([
    readHousehold(),
    readProvider(),
  ]);
  return publicSettings(
    household,
    Boolean(provider.tokens?.access_token),
    display,
  );
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

type SettingsPatch = {
  familyName?: string;
  members?: HouseholdMember[];
  calendarId?: string | null;
  listIds?: HouseholdListId[];
  timeZone?: string;
  uiScale?: UiScale;
  idleDimAfterMs?: IdleDimAfterMs;
  idleDimTo?: IdleDimTo;
  expectedVersion?: unknown;
};

function parseSettingsPatch(
  raw: unknown,
  fallback: DisplayConfig,
): { ok: true; value: SettingsPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid body" };
  }
  const o = raw as Record<string, unknown>;
  const value: SettingsPatch = { expectedVersion: o.expectedVersion };

  if (o.familyName !== undefined) {
    if (typeof o.familyName !== "string") {
      return { ok: false, error: "invalid body" };
    }
    value.familyName = o.familyName;
  }
  if (o.members !== undefined) {
    const roster = parseRoster(o.members);
    if (!roster.ok) return { ok: false, error: roster.error };
    value.members = roster.members;
  }
  if (o.calendarId !== undefined) {
    if (o.calendarId !== null && typeof o.calendarId !== "string") {
      return { ok: false, error: "invalid body" };
    }
    value.calendarId = o.calendarId;
  }
  if (o.listIds !== undefined) {
    value.listIds = parseListIds(o.listIds);
  }
  if (o.timeZone !== undefined) {
    if (!isIanaTimeZone(o.timeZone)) {
      return { ok: false, error: "invalid time zone" };
    }
    value.timeZone = o.timeZone;
  }
  if (o.uiScale !== undefined) {
    value.uiScale = parseUiScale(o.uiScale, fallback.uiScale);
  }
  if (o.idleDimAfterMs !== undefined) {
    value.idleDimAfterMs = parseIdleDimAfterMs(
      o.idleDimAfterMs,
      fallback.idleDimAfterMs,
    );
  }
  if (o.idleDimTo !== undefined) {
    value.idleDimTo = parseIdleDimTo(o.idleDimTo, fallback.idleDimTo);
  }
  return { ok: true, value };
}

function touchesHousehold(body: SettingsPatch): boolean {
  return (
    body.familyName !== undefined ||
    body.members !== undefined ||
    body.calendarId !== undefined ||
    body.listIds !== undefined ||
    body.timeZone !== undefined
  );
}

export async function handleGetSettings(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  return Response.json(await publicFromStores(display));
}

export async function handlePatchSettings(request: Request): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  const parsed = parseSettingsPatch(await readJson(request), display);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.value;

  const next: DisplayConfig = {
    uiScale: display.uiScale,
    idleDimAfterMs: display.idleDimAfterMs,
    idleDimTo: display.idleDimTo,
  };
  const provider = await readProvider();

  if (touchesHousehold(body)) {
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
      timeZone: body.timeZone,
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
          next,
        ),
        { status: 409 },
      );
    }
  }

  if (body.uiScale !== undefined) {
    next.uiScale = body.uiScale;
    const ok = await setDisplayUiScale(display.id, next.uiScale);
    if (!ok) {
      return Response.json({ error: "display missing" }, { status: 404 });
    }
  }

  if (body.idleDimAfterMs !== undefined || body.idleDimTo !== undefined) {
    next.idleDimAfterMs = body.idleDimAfterMs ?? next.idleDimAfterMs;
    next.idleDimTo = body.idleDimTo ?? next.idleDimTo;
    const ok = await setDisplayIdleDim(
      display.id,
      next.idleDimAfterMs,
      next.idleDimTo,
    );
    if (!ok) {
      return Response.json({ error: "display missing" }, { status: 404 });
    }
  }

  return Response.json(await publicFromStores(next));
}
