import { readAdminMembers } from "@/members/admin-client";
import { adminRequest } from "@/shared/admin-client";
import type { TaskAdminRead } from "./admin-types";

export async function readTaskAdminData() {
  const [roster, tasks] = await Promise.all([
    readAdminMembers(),
    adminRequest<TaskAdminRead>("tasks"),
  ]);
  return { members: roster.members, tasks };
}
