"use client";

import { useEffect, useState } from "react";

export function useClock(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(tick);
  }, [everyMs]);
  return now;
}
