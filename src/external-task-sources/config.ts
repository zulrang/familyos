import { createHash } from "node:crypto";
import { DERUPT_DEFAULT_ENDPOINT } from "./derupt";

/**
 * Where the token in use came from. A token saved in admin takes precedence
 * over `FAMILYOS_DERUPT_TOKEN`; clearing it falls back to the variable.
 */
export type DeruptTokenSource = "saved" | "environment";

/** How the Derupt adapter is configured from admin and the server environment. */
export type DeruptConfig =
  | Readonly<{ state: "disabled"; reason: "not_configured" }>
  | Readonly<{
      state: "disabled";
      reason: "invalid_token" | "invalid_endpoint";
      tokenSource: DeruptTokenSource;
    }>
  | Readonly<{
      state: "enabled";
      token: string;
      endpoint: string;
      tokenSource: DeruptTokenSource;
    }>;

type Env = Readonly<Record<string, string | undefined>>;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;

export function isDeruptToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** The token in use and where it came from: saved first, then the variable. */
export function deruptToken(
  env: Env,
  savedToken: string | null,
): { token: string; source: DeruptTokenSource } | null {
  if (savedToken) return { token: savedToken, source: "saved" };
  const fromEnv = env.FAMILYOS_DERUPT_TOKEN?.trim();
  return fromEnv ? { token: fromEnv, source: "environment" } : null;
}

/**
 * A saved token, else `FAMILYOS_DERUPT_TOKEN`, enables the source.
 * `FAMILYOS_DERUPT_ENDPOINT` overrides the processor URL for tests and local
 * Derupt stacks.
 */
export function deruptConfig(
  env: Env,
  savedToken: string | null = null,
): DeruptConfig {
  const chosen = deruptToken(env, savedToken);
  if (!chosen) return { state: "disabled", reason: "not_configured" };
  const tokenSource = chosen.source;
  if (!isDeruptToken(chosen.token))
    return { state: "disabled", reason: "invalid_token", tokenSource };
  const endpoint =
    env.FAMILYOS_DERUPT_ENDPOINT?.trim() || DERUPT_DEFAULT_ENDPOINT;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { state: "disabled", reason: "invalid_endpoint", tokenSource };
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  // The token is a password: send it over HTTPS except to this machine.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return { state: "disabled", reason: "invalid_endpoint", tokenSource };
  return {
    state: "enabled",
    token: chosen.token,
    endpoint: url.toString(),
    tokenSource,
  };
}

/**
 * Identifies what the poller runs with, so a status can be matched to the
 * configuration it describes. A digest, so the token itself is not kept.
 */
export function deruptConfigKey(config: DeruptConfig): string {
  if (config.state === "disabled") return `disabled:${config.reason}`;
  return createHash("sha256")
    .update(`${config.endpoint}\n${config.token}`)
    .digest("hex");
}
