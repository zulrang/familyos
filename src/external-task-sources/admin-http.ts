import { activeMembers, type HouseholdMember } from "@/members/members";
import { readHousehold, updateHousehold } from "@/settings/settings";
import { adminJson, requireAdmin } from "@/shared/admin-auth";
import { deruptConfig } from "./config";
import { type SourceStatus, sourceStatus } from "./source-status";

export type AdminTaskSource = Readonly<{
  id: "derupt";
  name: string;
  status: SourceStatus | { state: "starting" };
}>;

export type AdminTaskSourcesRead = Readonly<{
  members: HouseholdMember[];
  defaultMember: string | null;
  timeZone: string;
  version: number;
  sources: AdminTaskSource[];
}>;

function deruptStatus(): AdminTaskSource["status"] {
  const status = sourceStatus("derupt");
  if (status) return status;
  // Polling starts with the server; until then report what it will do.
  const config = deruptConfig(process.env);
  return config.state === "disabled" ? config : { state: "starting" };
}

async function read(): Promise<AdminTaskSourcesRead> {
  const household = await readHousehold();
  return {
    members: household.members,
    defaultMember: household.externalTaskDefaultMember,
    timeZone: household.timeZone,
    version: household.configVersion,
    sources: [{ id: "derupt", name: "Derupt", status: deruptStatus() }],
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
