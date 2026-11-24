"use client";

import { useEffect } from "react";
import { displayWatchAction, parseReadySnapshot } from "./display-watch";

export function DisplayTrustWatch() {
  useEffect(() => {
    let cancelled = false;
    let knownBuildId: string | null = null;

    async function check() {
      try {
        const res = await fetch("/api/ready", { cache: "no-store" });
        const ready = parseReadySnapshot(await res.json());
        if (!ready || cancelled) return;
        const action = displayWatchAction(knownBuildId, ready);
        if (action.kind === "pairing") {
          window.location.assign("/");
          return;
        }
        if (action.kind === "reload") {
          window.location.reload();
          return;
        }
        knownBuildId = action.buildId;
      } catch {}
    }

    void check();
    const id = window.setInterval(() => {
      void check();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
