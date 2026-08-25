"use client";

import { useEffect, useRef } from "react";
import { pairingUrl } from "@/shared/pairing-qr";
import { IconButton } from "@/shared/ui/IconButton";
import { QrCode } from "@/shared/ui/QrCode";

export function PairingCodeDialog({
  code,
  expiresAt,
  origin,
  onClose,
}: {
  code: string;
  expiresAt: number;
  origin: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const minutesLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (typeof el.showModal === "function") {
      if (!el.open) el.showModal();
    } else {
      el.setAttribute("open", "");
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (typeof el.close === "function" && el.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pairing-code-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        width: "min(420px, calc(100% - 48px))",
        padding: "28px 28px 32px",
        border: "none",
        background: "var(--surface-screen)",
        borderRadius: "var(--radius-panel)",
        boxShadow: "var(--shadow-panel)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
          }}
        >
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <h2
          id="pairing-code-title"
          style={{
            margin: 0,
            font: "var(--type-section)",
            color: "var(--text-title)",
          }}
        >
          Pair Display
        </h2>
        <QrCode value={pairingUrl(origin, code)} label="Pairing QR code" />
        <p
          style={{
            margin: 0,
            font: "var(--fw-semibold) 28px/1 var(--font-sans)",
            letterSpacing: "0.18em",
            color: "var(--text-title)",
          }}
        >
          {code}
        </p>
        <p
          style={{
            margin: 0,
            textAlign: "center",
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
          }}
        >
          Scan the QR with an unpaired browser, or type this code. Expires in ~
          {minutesLeft} min.
        </p>
      </div>
    </dialog>
  );
}
