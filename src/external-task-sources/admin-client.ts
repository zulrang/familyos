import { adminRequest } from "@/shared/admin-client";
import type { AdminTaskSourcesRead } from "./admin-http";

export type {
  AdminTaskSource,
  AdminTaskSourcesRead,
  TokenSummary,
} from "./admin-http";

export const readAdminTaskSources = () =>
  adminRequest<AdminTaskSourcesRead>("task-sources");

export const saveDefaultMember = (
  defaultMember: string | null,
  expectedVersion: number,
) =>
  adminRequest<AdminTaskSourcesRead>("task-sources", {
    defaultMember,
    expectedVersion,
  });

export const saveDeruptToken = (token: string) =>
  adminRequest<AdminTaskSourcesRead>(
    "task-sources/derupt-token",
    { token },
    "PUT",
  );

export const clearDeruptToken = () =>
  adminRequest<AdminTaskSourcesRead>(
    "task-sources/derupt-token",
    undefined,
    "DELETE",
  );
