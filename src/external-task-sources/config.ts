import { DERUPT_DEFAULT_ENDPOINT } from "./derupt";

/** How the Derupt adapter is configured from the server environment. */
export type DeruptConfig =
  | Readonly<{
      state: "disabled";
      reason: "not_configured" | "invalid_token" | "invalid_endpoint";
    }>
  | Readonly<{ state: "enabled"; token: string; endpoint: string }>;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `FAMILYOS_DERUPT_TOKEN` enables the source. `FAMILYOS_DERUPT_ENDPOINT`
 * overrides the processor URL for tests and local Derupt stacks.
 */
export function deruptConfig(env: Env): DeruptConfig {
  const token = env.FAMILYOS_DERUPT_TOKEN?.trim() ?? "";
  if (!token) return { state: "disabled", reason: "not_configured" };
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(token))
    return { state: "disabled", reason: "invalid_token" };
  const endpoint =
    env.FAMILYOS_DERUPT_ENDPOINT?.trim() || DERUPT_DEFAULT_ENDPOINT;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { state: "disabled", reason: "invalid_endpoint" };
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  // The token is a password: send it over HTTPS except to this machine.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return { state: "disabled", reason: "invalid_endpoint" };
  return { state: "enabled", token, endpoint: url.toString() };
}
