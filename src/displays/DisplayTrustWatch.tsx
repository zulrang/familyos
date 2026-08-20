"use client";

import { useEffect } from "react";

/** When this Display is revoked elsewhere, drop back to pairing-only UI. */
export function DisplayTrustWatch() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/ready");
        const body = (await res.json()) as { paired?: boolean };
        if (!cancelled && body.paired === false) {
          window.location.assign("/");
        }
      } catch {
        /* transient network; try again next tick */
      }
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
