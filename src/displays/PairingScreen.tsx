"use client";

import { useCallback, useEffect, useState } from "react";
import { pairingCodeFromSearch } from "@/shared/pairing-qr";
import { Button } from "@/shared/ui/Button";

const QR_PAIR_ATTEMPT_KEY = "fos_qr_pair";
const attemptedPairingCodes = new Set<string>();

export function PairingScreen() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pairWith = useCallback(async (nextCode: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: nextCode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const reason = body?.error;
        setError(
          reason === "expired"
            ? "That code has expired."
            : reason === "reused"
              ? "That code was already used."
              : "That code did not work.",
        );
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Could not pair this Display.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const scanned = pairingCodeFromSearch(window.location.search);
    if (!scanned) return;
    setCode(scanned);
    if (attemptedPairingCodes.has(scanned)) return;
    attemptedPairingCodes.add(scanned);
    try {
      if (sessionStorage.getItem(QR_PAIR_ATTEMPT_KEY) === scanned) return;
      sessionStorage.setItem(QR_PAIR_ATTEMPT_KEY, scanned);
    } catch {}
    void pairWith(scanned);
  }, [pairWith]);

  return (
    <main
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-app)",
        padding: 32,
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          background: "var(--surface-screen)",
          borderRadius: "var(--radius-panel)",
          padding: "36px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              font: "var(--type-screen-title)",
              color: "var(--text-title)",
            }}
          >
            Pair Display
          </h1>
          <p
            style={{
              margin: "10px 0 0",
              font: "var(--type-card-meta)",
              color: "var(--text-muted)",
            }}
          >
            Enter the short-lived code from the Server Installation or another
            Trusted Display, or scan its QR code.
          </p>
        </div>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            font: "var(--type-card-meta)",
            color: "var(--text-body)",
          }}
        >
          Pairing code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && code.trim().length >= 4) {
                void pairWith(code);
              }
            }}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={8}
            disabled={busy}
            style={{
              height: 52,
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--border-hairline)",
              padding: "0 18px",
              font: "var(--fw-semibold) 22px/1 var(--font-sans)",
              letterSpacing: "0.18em",
              textAlign: "center",
              color: "var(--text-title)",
              background: "var(--surface-sunken)",
            }}
          />
        </label>
        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              font: "var(--type-card-meta)",
              color: "var(--member-coral-ink)",
            }}
          >
            {error}
          </p>
        ) : null}
        <Button
          variant="primary"
          disabled={busy || code.trim().length < 4}
          onClick={() => {
            void pairWith(code);
          }}
        >
          Pair
        </Button>
      </div>
    </main>
  );
}
