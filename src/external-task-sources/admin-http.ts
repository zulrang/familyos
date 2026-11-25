import { activeMembers, type HouseholdMember } from "@/members/members";
import { readHousehold, updateHousehold } from "@/settings/settings";
import { adminJson, requireAdmin } from "@/shared/admin-auth";
import {
  type DeruptTokenSource,
  deruptConfig,
  deruptConfigKey,
  deruptToken,
  isDeruptToken,
} from "./config";
import {
  type SourceStatus,
  sourceStatusFor,
  wakeExternalTaskSources,
} from "./source-status";
import {
  clearDeruptToken,
  readSavedDeruptToken,
  saveDeruptToken,
} from "./token-store";

/**
 * Which token is in use, never the token: `ending` is its last four
 * characters when it is well formed, so a parent can tell tokens apart.
 */
export type TokenSummary = Readonly<{
  source: DeruptTokenSource | null;
  ending: string | null;
  environmentSet: boolean;
}>;

export type AdminTaskSource = Readonly<{
  id: "derupt";
  name: string;
  status: SourceStatus | { state: "starting" };
  token: TokenSummary;
}>;

export type AdminTaskSourcesRead = Readonly<{
  members: HouseholdMember[];
  defaultMember: string | null;
  timeZone: string;
  version: number;
  sources: AdminTaskSource[];
}>;

function derupt(): AdminTaskSource {
  const saved = readSavedDeruptToken();
  const config = deruptConfig(process.env, saved);
  const chosen = deruptToken(process.env, saved);
  // The poller's status counts only once it runs with this configuration;
  // until then (startup, or just after a token change) report what it will do.
  const status: AdminTaskSource["status"] =
    sourceStatusFor("derupt", deruptConfigKey(config)) ??
    (config.state === "disabled"
      ? { state: "disabled", reason: config.reason }
      : { state: "starting" });
  return {
    id: "derupt",
    name: "Derupt",
    status,
    token: {
      source: chosen?.source ?? null,
      ending:
        chosen && isDeruptToken(chosen.token) ? chosen.token.slice(-4) : null,
      environmentSet: !!process.env.FAMILYOS_DERUPT_TOKEN?.trim(),
    },
  };
}

async function read(): Promise<AdminTaskSourcesRead> {
  const household = await readHousehold();
  return {
    members: household.members,
    defaultMember: household.externalTaskDefaultMember,
    timeZone: household.timeZone,
    version: household.configVersion,
    sources: [derupt()],
  };
}

export async function handleAdminTaskSources(
  request: Request,
): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  if (request.method === "GET") return adminJson(await read());
  const raw: unknown = await request.json().catch(() => null);
  if (
    !raw ||
    typeof raw !== "object" ||
    !("defaultMember" in raw) ||
    !("expectedVersion" in raw) ||
    (raw.defaultMember !== null && typeof raw.defaultMember !== "string")
  )
    return adminJson({ error: "Invalid default member request." }, 400);
  const household = await readHousehold();
  if (
    raw.defaultMember !== null &&
    !activeMembers(household.members).some(
      (member) => member.id === raw.defaultMember,
    )
  )
    return adminJson({ error: "Choose an active member." }, 400);
  const result = await updateHousehold(raw.expectedVersion, {
    externalTaskDefaultMember: raw.defaultMember,
  });
  if (!result.ok)
    return adminJson(
      {
        error:
          result.reason === "version"
            ? "Household settings changed on another screen. Refresh before saving."
            : "Invalid household configuration.",
      },
      result.reason === "version" ? 409 : 400,
    );
  return adminJson(await read());
}

/**
 * PUT `{ token }` saves or replaces the Derupt token; DELETE clears it. Either
 * applies at once. Responses carry the token summary, never the token.
 */
export async function handleAdminDeruptToken(
  request: Request,
): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  if (request.method === "DELETE") {
    await clearDeruptToken();
  } else if (request.method === "PUT") {
    const raw: unknown = await request.json().catch(() => null);
    const token =
      raw && typeof raw === "object" && "token" in raw
        ? typeof raw.token === "string"
          ? raw.token.trim()
          : null
        : null;
    if (token === null || !isDeruptToken(token))
      return adminJson(
        {
          error:
            "That doesn’t look like a Derupt connection token. Copy it again from Derupt.",
        },
        400,
      );
    await saveDeruptToken(token);
  } else {
    return adminJson({ error: "Method not allowed." }, 405);
  }
  wakeExternalTaskSources();
  return adminJson(await read());
}
