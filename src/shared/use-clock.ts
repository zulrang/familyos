"use client";

import { useEffect, useState } from "react";

/** The current instant, refreshed every `everyMs`. */
export function useClock(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(tick);
  }, [everyMs]);
  return now;
}
