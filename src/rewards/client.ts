"use client";
import { redirectIfPairingRequired } from "@/shared/display-client";
import type { RewardSpend, RewardsCommand, RewardsRead } from "./types";
export function rewardsRequest(): Promise<RewardsRead>;
export function rewardsRequest(
  command: RewardsCommand,
): Promise<{ spend: RewardSpend | null }>;
export async function rewardsRequest(
  command?: RewardsCommand,
): Promise<RewardsRead | { spend: RewardSpend | null }> {
  const response = await fetch("/api/rewards", {
    method: command ? "POST" : "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(command ? { body: JSON.stringify(command) } : {}),
  });
  if (await redirectIfPairingRequired(response))
    throw new Error("Display pairing required.");
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not save reward choice.");
  return body;
}
