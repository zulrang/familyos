import { adminRequest } from "@/shared/admin-client";
import type { HouseholdMember } from "./members";

export type AdminMembersRead = { members: HouseholdMember[]; version: number };
export const readAdminMembers = () => adminRequest<AdminMembersRead>("members");
