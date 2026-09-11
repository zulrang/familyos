"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppHeader } from "@/shared/AppHeader";
import { Button } from "@/shared/ui/Button";
import { QrCode } from "@/shared/ui/QrCode";
import styles from "./PhotosScreen.module.css";
import type { PhotosStatus } from "./photos";

type ScreenState =
  | { state: "loading" }
  | { state: "loaded"; status: PhotosStatus }
  | { state: "error"; message: string };

type ViewMode =
  | { state: "slideshow" }
  | { state: "settings" }
  | { state: "fullscreen"; controlsVisible: boolean };

type PhotosPresentation =
  | { mode?: "screen" }
  | {
      mode: "idle";
      idle: boolean;
      onDismiss: () => void;
      children: ReactNode;
    };

async function requestPhotos(
  action?: "connect" | "poll" | "disconnect",
  signal?: AbortSignal,
): Promise<PhotosStatus> {
  const response = await fetch("/api/photos", {
    method: action === "disconnect" ? "DELETE" : action ? "POST" : "GET",
    headers:
      action && action !== "disconnect"
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      action && action !== "disconnect"
        ? JSON.stringify({ action })
        : undefined,
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Google Photos is unavailable.");
  return body as PhotosStatus;
}

export function PhotosScreen(props: PhotosPresentation = {}) {
  const [screen, setScreen] = useState<ScreenState>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>({ state: "slideshow" });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const idleDialog = useRef<HTMLDialogElement>(null);

  async function update(action?: "connect" | "poll" | "disconnect") {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const status = await requestPhotos(action, controller.signal);
      if (!controller.signal.aborted) setScreen({ state: "loaded", status });
    } catch (error) {
      if (!controller.signal.aborted)
        setScreen({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Google Photos is unavailable.",
        });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    requestPhotos(undefined, controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) setScreen({ state: "loaded", status });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setScreen({
            state: "error",
            message:
              error instanceof Error
                ? error.message
                : "Google Photos is unavailable.",
          });
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (busy) return;
    const pollAfterMs =
      screen.state === "loaded" && "pollAfterMs" in screen.status
        ? screen.status.pollAfterMs
        : props.mode === "idle"
          ? 60_000
          : null;
    if (pollAfterMs === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      active.current = controller;
      requestPhotos("poll", controller.signal)
        .then((status) => {
          if (!controller.signal.aborted)
            setScreen({ state: "loaded", status });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setScreen({
              state: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Google Photos is unavailable.",
            });
        });
    }, pollAfterMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [screen, busy, props.mode]);

  const status = screen.state === "loaded" ? screen.status : null;
  const ready = status?.state === "ready" ? status : null;
  const selection =
    status?.state === "selecting"
      ? status
      : ready && viewMode.state === "settings"
        ? ready
        : null;
  const count = ready?.photos.length ?? 0;
  const photo = ready?.photos[index % Math.max(1, count)];
  const playing = props.mode !== "idle" || props.idle;
  const showingIdle =
    props.mode === "idle" && props.idle && !!photo && failedSrc !== photo.src;

  useEffect(() => {
    if (!showingIdle) return;
    const dialog = idleDialog.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
    };
  }, [showingIdle]);

  useEffect(() => {
    if (!ready || count < 2) return;
    // Warm the browser cache for the next slide so the 15s swap is instant.
    const next = new Image();
    next.src = ready.photos[(index + 1) % count].src;
  }, [ready, index, count]);

  useEffect(() => {
    if (!playing || paused || viewMode.state === "settings" || count < 2)
      return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % count),
      15_000,
    );
    return () => clearInterval(timer);
  }, [playing, paused, viewMode.state, count]);

  useEffect(() => {
    if (viewMode.state !== "fullscreen") return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMode({ state: "slideshow" });
    };
    document.addEventListener("keydown", exitOnEscape);
    return () => document.removeEventListener("keydown", exitOnEscape);
  }, [viewMode.state]);

  useEffect(() => {
    if (viewMode.state !== "fullscreen" || !viewMode.controlsVisible) return;
    const timer = setTimeout(
      () =>
        setViewMode((value) =>
          value.state === "fullscreen"
            ? { state: "fullscreen", controlsVisible: false }
            : value,
        ),
      3_000,
    );
    return () => clearTimeout(timer);
  }, [viewMode]);

  function revealFullscreenControls() {
    setViewMode((value) =>
      value.state === "fullscreen"
        ? { state: "fullscreen", controlsVisible: true }
        : value,
    );
  }

  if (props.mode === "idle") {
    return (
      <>
        <div className={styles.idleContent} inert={showingIdle}>
          {props.children}
        </div>
        {showingIdle &&
          photo &&
          createPortal(
            <dialog
              ref={idleDialog}
              className={styles.idleDialog}
              aria-label="Idle photo slideshow"
              onCancel={(event) => {
                event.preventDefault();
                props.onDismiss();
              }}
            >
              <button
                type="button"
                data-idle-slideshow=""
                className={styles.idleSlideshow}
                aria-label="Return to previous screen"
                onPointerDown={(event) => event.preventDefault()}
                onClick={props.onDismiss}
              >
                {/* biome-ignore lint/performance/noImgElement: private authenticated photo stream */}
                <img
                  src={photo.src}
                  alt={ready?.sourceName}
                  className={styles.photo}
                  onError={() => setFailedSrc(photo.src)}
                />
              </button>
            </dialog>,
            document.body,
          )}
      </>
    );
  }

  return (
    <div className={styles.screen}>
      <AppHeader
        title="Photos"
        actions={
          ready ? (
            <Button
              onClick={() =>
                setViewMode((value) =>
                  value.state === "settings"
                    ? { state: "slideshow" }
                    : { state: "settings" },
                )
              }
            >
              {viewMode.state === "settings"
                ? "Back to photos"
                : "Photo settings"}
            </Button>
          ) : undefined
        }
      />
      {screen.state === "loading" && (
        <output className={styles.empty}>Loading photos…</output>
      )}
      {screen.state === "error" && (
        <div className={styles.empty}>
          <p role="alert">{screen.message}</p>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => void update("poll")}>
              Retry
            </Button>
            <Button disabled={busy} onClick={() => void update("disconnect")}>
              Disconnect Photos
            </Button>
          </div>
        </div>
      )}
      {status?.state === "unconfigured" && (
        <div className={styles.empty}>
          <h2>Sign in to Google Photos</h2>
          <p>Sign in with Google in Settings before choosing photos.</p>
        </div>
      )}
      {status?.state === "disconnected" && (
        <div className={styles.empty}>
          <h2>Family photos, together</h2>
          <p>
            Connect Google Photos and choose the photos for all household
            displays.
          </p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void update("connect")}
          >
            Connect Google Photos
          </Button>
        </div>
      )}
      {selection && (
        <div className={styles.empty}>
          <h2>{ready ? ready.sourceName : "Choose photos"}</h2>
          <p>
            Select photos to display in FamilyOS. Search for the album by name
            in Google Photos, then tap Done.
          </p>
          <QrCode value={selection.pickerUrl} label="Choose Google Photos" />
          <a href={selection.pickerUrl} target="_blank" rel="noreferrer">
            Choose photos in Google Photos
          </a>
          {!ready && <output>Waiting for photo selection…</output>}
          <Button
            disabled={busy}
            onClick={() => {
              setViewMode({ state: "slideshow" });
              void update("disconnect");
            }}
          >
            Disconnect Photos
          </Button>
        </div>
      )}
      {ready && viewMode.state !== "settings" && (
        <div
          className={`${styles.slideshow} ${
            viewMode.state === "fullscreen" ? styles.fullscreen : ""
          }`}
          onPointerDown={revealFullscreenControls}
        >
          <div className={styles.viewer}>
            {photo ? (
              <>
                {/* Google media is served through the paired-display endpoint; it must not enter Next's public image cache. */}
                {/* biome-ignore lint/performance/noImgElement: private authenticated photo stream */}
                <img
                  key={photo.src}
                  src={photo.src}
                  alt={ready.sourceName}
                  className={styles.photo}
                  onError={() => setFailedSrc(photo.src)}
                />
                {failedSrc === photo.src && (
                  <output className={styles.imageError}>
                    This photo is unavailable. Try the next photo.
                  </output>
                )}
              </>
            ) : (
              <div className={styles.empty}>
                <h2>{ready.sourceName}</h2>
                <output>
                  No photos available yet. Google Photos will refresh
                  automatically.
                </output>
              </div>
            )}
          </div>
          <div
            className={`${styles.controls} ${
              viewMode.state === "fullscreen" && !viewMode.controlsVisible
                ? styles.controlsHidden
                : ""
            }`}
            aria-hidden={
              viewMode.state === "fullscreen" && !viewMode.controlsVisible
            }
            inert={viewMode.state === "fullscreen" && !viewMode.controlsVisible}
          >
            <span>{ready.sourceName}</span>
            <div className={styles.actions}>
              <Button
                disabled={count < 2}
                onClick={() =>
                  setIndex((value) => ((value % count) - 1 + count) % count)
                }
              >
                Previous
              </Button>
              <Button
                disabled={count < 2}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? "Play slideshow" : "Pause slideshow"}
              </Button>
              <Button
                disabled={count < 2}
                onClick={() => setIndex((value) => (value + 1) % count)}
              >
                Next
              </Button>
              <Button
                disabled={!photo}
                onClick={() =>
                  setViewMode((value) =>
                    value.state === "fullscreen"
                      ? { state: "slideshow" }
                      : { state: "fullscreen", controlsVisible: true },
                  )
                }
              >
                {viewMode.state === "fullscreen"
                  ? "Exit full screen"
                  : "Full screen"}
              </Button>
            </div>
            <span>{count ? `${(index % count) + 1}/${count}` : "0/0"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
