"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  IDLE_DIM_CHANGED,
  type IdleDim,
  type IdleDimAfterMs,
} from "@/shared/idle-dim";
import { PhotosScreen } from "./PhotosScreen";

export function IdlePhotos({
  idleDimAfterMs,
  children,
}: {
  idleDimAfterMs: IdleDimAfterMs;
  children: ReactNode;
}) {
  const [state, setState] = useState<"active" | "idle">("active");
  const [afterMs, setAfterMs] = useState(idleDimAfterMs);

  useEffect(() => setAfterMs(idleDimAfterMs), [idleDimAfterMs]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function restart() {
      clearTimeout(timer);
      timer = setTimeout(() => setState("idle"), afterMs);
    }
    function activity(event: Event) {
      // Keep the overlay through pointer-up so the wake-up tap cannot click
      // a control on the screen underneath. Its click handler dismisses it.
      if (state === "idle") {
        if (event.type === "keydown") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setState("active");
        } else if (
          !(event.target instanceof Element) ||
          !event.target.closest("[data-idle-slideshow]")
        ) {
          setState("active");
        }
        return;
      }
      restart();
    }
    function configurationChanged(event: Event) {
      setAfterMs((event as CustomEvent<IdleDim>).detail.idleDimAfterMs);
      setState("active");
      restart();
    }
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "click"];
    for (const event of events) window.addEventListener(event, activity, true);
    window.addEventListener(IDLE_DIM_CHANGED, configurationChanged);
    restart();
    return () => {
      clearTimeout(timer);
      for (const event of events)
        window.removeEventListener(event, activity, true);
      window.removeEventListener(IDLE_DIM_CHANGED, configurationChanged);
    };
  }, [afterMs, state]);

  return (
    <PhotosScreen
      mode="idle"
      idle={state === "idle"}
      onDismiss={() => setState("active")}
    >
      {children}
    </PhotosScreen>
  );
}
