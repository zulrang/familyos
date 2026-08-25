"use client";

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
  const minutesLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));

  return (
    <dialog
      open
      aria-labelledby="pairing-code-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        width: "100%",
        height: "100%",
        maxWidth: "none",
        maxHeight: "none",
        margin: 0,
        padding: 24,
        border: "none",
        background: "rgba(31, 42, 51, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          background: "var(--surface-screen)",
          borderRadius: "var(--radius-panel)",
          boxShadow: "var(--shadow-panel)",
          padding: "28px 28px 32px",
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
            top: 12,
            right: 12,
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
