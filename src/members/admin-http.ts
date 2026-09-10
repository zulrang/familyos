import { readHousehold, updateHousehold } from "@/settings/settings";
import { adminJson, requireAdmin } from "@/shared/admin-auth";
import {
  type HouseholdMember,
  parseMemberColor,
  retireMember,
} from "./members";

export async function handleAdminMembers(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const household = await readHousehold();
  if (request.method === "GET")
    return adminJson({
      members: household.members,
      version: household.configVersion,
    });
  const raw: unknown = await request.json().catch(() => null);
  if (
    !raw ||
    typeof raw !== "object" ||
    !("kind" in raw) ||
    !("id" in raw) ||
    typeof raw.id !== "string" ||
    !raw.id ||
    !("expectedVersion" in raw)
  )
    return adminJson({ error: "Invalid member request." }, 400);
  let members: HouseholdMember[] = household.members;
  const existing = members.find((member) => member.id === raw.id);
  if (raw.kind === "retire") {
    const retired = retireMember(members, raw.id);
    if (!retired) return adminJson({ error: "Member not found." }, 404);
    members = retired;
  } else if (raw.kind === "create" || raw.kind === "edit") {
    if (!("name" in raw) || typeof raw.name !== "string" || !raw.name.trim())
      return adminJson({ error: "Enter a member name." }, 400);
    if (raw.kind === "create" && existing)
      return adminJson(
        { error: "Member already exists. Refresh to continue." },
        409,
      );
    if (raw.kind === "edit" && !existing)
      return adminJson({ error: "Member not found." }, 404);
    const color = "color" in raw ? parseMemberColor(raw.color) : null;
    if (existing?.status !== "retired" && !color)
      return adminJson({ error: "Choose a valid member color." }, 400);
    const member: HouseholdMember =
      existing?.status === "retired"
        ? { id: existing.id, name: raw.name.trim(), status: "retired" }
        : {
            id: raw.id,
            name: raw.name.trim(),
            status: "active",
            color: color ?? "#a9d8d2",
          };
    members =
      raw.kind === "create"
        ? [...members, member]
        : members.map((row) => (row.id === member.id ? member : row));
  } else return adminJson({ error: "Invalid member action." }, 400);
  const result = await updateHousehold(raw.expectedVersion, { members });
  if (!result.ok) {
    if (result.reason === "version")
      return adminJson(
        { error: "Members changed on another screen. Refresh before saving." },
        409,
      );
    const messages: Record<string, string> = {
      too_many_active: "A household can have up to six active members.",
      duplicate_active_color: "Each active member needs a different color.",
    };
    return adminJson(
      {
        error:
          result.reason === "roster"
            ? (messages[result.error] ?? "Check the member details.")
            : "Invalid household configuration.",
      },
      400,
    );
  }
  return adminJson({
    members: result.config.members,
    version: result.config.configVersion,
  });
}
