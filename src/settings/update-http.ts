import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { adminJson, requireAdmin } from "@/shared/admin-auth";
import { isUnauthorized, requireTrustedDisplay } from "@/shared/display-auth";

const execFileAsync = promisify(execFile);

const DEFAULT_MACOS_SERVER_PATH = path.join(
  process.cwd(),
  "scripts/macos-server",
);

type UpdateHandlerOptions = {
  serverPath?: string;
};

export async function handleKickUpdate(
  request: Request,
  options?: UpdateHandlerOptions,
): Promise<Response> {
  const display = await requireTrustedDisplay(request);
  if (isUnauthorized(display)) return display;
  return kickUpdate(Response.json, options);
}

export async function handleAdminUpdate(
  request: Request,
  options?: UpdateHandlerOptions,
): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return kickUpdate((body, init) => adminJson(body, init?.status), options);
}

export async function handleAdminUpdateCheck(
  request: Request,
  options?: UpdateHandlerOptions,
): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const { stdout } = await execFileAsync(
      options?.serverPath ?? DEFAULT_MACOS_SERVER_PATH,
      ["check-update"],
      {
        timeout: 15_000,
      },
    );
    const result: unknown = JSON.parse(stdout);
    if (
      !result ||
      typeof result !== "object" ||
      !("available" in result) ||
      typeof result.available !== "boolean"
    ) {
      throw new Error("Invalid update check response.");
    }
    return adminJson({ available: result.available });
  } catch {
    return adminJson({ error: "Could not check for updates." }, 503);
  }
}

async function kickUpdate(
  json: typeof Response.json,
  options?: UpdateHandlerOptions,
): Promise<Response> {
  try {
    await execFileAsync(
      options?.serverPath ?? DEFAULT_MACOS_SERVER_PATH,
      ["kick-update"],
      {
        timeout: 15_000,
      },
    );
  } catch {
    return json({ error: "Could not start update." }, { status: 500 });
  }
  return json({ ok: true }, { status: 202 });
}
