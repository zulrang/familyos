"use client";

import { useEffect } from "react";
import { applyIdleDim, type IdleDim } from "@/shared/idle-dim";

/** Best-effort loopback apply on a trusted page load. */
export function IdleDimApply({ idleDimAfterMs, idleDimTo }: IdleDim) {
  useEffect(() => {
    void applyIdleDim({ idleDimAfterMs, idleDimTo });
  }, [idleDimAfterMs, idleDimTo]);
  return null;
}
