"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  IDLE_DIM_CHANGED,
  type IdleDim,
  type IdleDimAfterMs,
} from "@/shared/idle-dim";
import { SleepContext } from "@/shared/SleepContext";
import { type IdleActivation, PhotosScreen } from "./PhotosScreen";

export function IdlePhotos({
  idleDimAfterMs,
  children,
}: {
  idleDimAfterMs: IdleDimAfterMs;
  children: ReactNode;
}) {
  const [state, setState] = useState<IdleActivation>("active");
  const [afterMs, setAfterMs] = useState(idleDimAfterMs);

  useEffect(() => setAfterMs(idleDimAfterMs), [idleDimAfterMs]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function restart() {
      clearTimeout(timer);
      timer = setTimeout(() => setState("automatic"), afterMs);
    }
    function activity(event: Event) {
      // Keep the overlay through pointer-up so the wake-up tap cannot click
      // a control on the screen underneath. Its click handler dismisses it.
      if (state !== "active") {
        if (
          state === "automatic" &&
          !document.querySelector("[data-idle-dialog]")
        ) {
          setState("active");
          return;
        }
        const insideDialog =
          event.target instanceof Element &&
          !!event.target.closest("[data-idle-dialog]");
        const slideshowTarget =
          event.target instanceof Element &&
          !!event.target.closest("[data-idle-slideshow]");
        if (
          event.type === "keydown" &&
          (!insideDialog ||
            state === "automatic" ||
            slideshowTarget ||
            (event instanceof KeyboardEvent && event.key === "Escape"))
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setState("active");
        } else if (!insideDialog) {
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
    if (state === "active") restart();
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
      activation={state}
      onDismiss={() => setState("active")}
    >
      <SleepContext value={() => setState("manual")}>{children}</SleepContext>
    </PhotosScreen>
  );
}
