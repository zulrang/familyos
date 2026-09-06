"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/shared/AppHeader";
import { Button } from "@/shared/ui/Button";
import { QrCode } from "@/shared/ui/QrCode";
import styles from "./PhotosScreen.module.css";
import type { PhotosStatus } from "./photos";

type ScreenState =
  | { state: "loading" }
  | { state: "loaded"; status: PhotosStatus }
  | { state: "error"; message: string };

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

export function PhotosScreen() {
  const [screen, setScreen] = useState<ScreenState>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);

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
    if (busy || screen.state !== "loaded" || !("pollAfterMs" in screen.status))
      return;
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
    }, screen.status.pollAfterMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [screen, busy]);

  const status = screen.state === "loaded" ? screen.status : null;
  const ready = status?.state === "ready" ? status : null;
  const selection =
    status?.state === "selecting"
      ? status
      : ready && showSettings
        ? ready
        : null;
  const count = ready?.photos.length ?? 0;
  const photo = ready?.photos[index % Math.max(1, count)];

  useEffect(() => {
    if (paused || showSettings || count < 2) return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % count),
      15_000,
    );
    return () => clearInterval(timer);
  }, [paused, showSettings, count]);

  return (
    <div className={styles.screen}>
      <AppHeader
        title="Photos"
        actions={
          ready ? (
            <Button onClick={() => setShowSettings((value) => !value)}>
              {showSettings ? "Back to photos" : "Photo settings"}
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
          <h2>Connect Google Photos</h2>
          <p>Google Photos setup is needed on the household server.</p>
        </div>
      )}
      {status?.state === "disconnected" && (
        <div className={styles.empty}>
          <h2>Family photos, together</h2>
          <p>
            Connect Google Photos and choose one album for all household
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
      {status?.state === "authorizing" && (
        <div className={styles.empty}>
          <h2>Connect Google Photos</h2>
          <p>Scan with a phone, then enter this code.</p>
          <QrCode
            value={status.verificationUrl}
            label="Open Google Photos sign-in"
          />
          <strong className={styles.code}>{status.userCode}</strong>
          <a href={status.verificationUrl} target="_blank" rel="noreferrer">
            Open Google sign-in
          </a>
          <output>Waiting for authorization…</output>
          <Button disabled={busy} onClick={() => void update("disconnect")}>
            Cancel
          </Button>
        </div>
      )}
      {selection && (
        <div className={styles.empty}>
          <h2>{ready ? ready.sourceName : "Choose one album"}</h2>
          <p>
            Select exactly one album in Google Photos to share with FamilyOS.
          </p>
          <QrCode
            value={selection.settingsUrl}
            label="Choose a Google Photos album"
          />
          <a href={selection.settingsUrl} target="_blank" rel="noreferrer">
            Choose album in Google Photos
          </a>
          {!ready && <output>Waiting for one album selection…</output>}
          <Button
            disabled={busy}
            onClick={() => {
              setShowSettings(false);
              void update("disconnect");
            }}
          >
            Disconnect Photos
          </Button>
        </div>
      )}
      {ready && !showSettings && (
        <>
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
          <div className={styles.controls}>
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
            </div>
            <span>{count ? `${(index % count) + 1}/${count}` : "0/0"}</span>
          </div>
        </>
      )}
    </div>
  );
}
