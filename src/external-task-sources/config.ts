import { DERUPT_DEFAULT_ENDPOINT } from "./derupt";

export type DeruptConfig =
  | Readonly<{
      state: "disabled";
      reason: "not_configured" | "invalid_token" | "invalid_endpoint";
    }>
  | Readonly<{ state: "enabled"; token: string; endpoint: string }>;

type Env = Readonly<Record<string, string | undefined>>;

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
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return { state: "disabled", reason: "invalid_endpoint" };
  return { state: "enabled", token, endpoint: url.toString() };
}
