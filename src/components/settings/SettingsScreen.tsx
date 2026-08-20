"use client";

import { useEffect, useState } from "react";
import { TONE_GOOGLE_NAME } from "@/lib/calendar";
import { redirectIfPairingRequired } from "@/lib/display-client";
import {
  type GoogleCalendar,
  MEMBER_TONES,
  type Member,
  type PublicSettings,
  parseUiScale,
  UI_SCALES,
  type UiScale,
} from "@/lib/types";
import { Button } from "../core/Button";
import { AppHeader } from "../nav/AppHeader";

type DisplayRecord = {
  id: string;
  createdAt: number;
  revokedAt: number | null;
};

function newMember(existing: Member[]): Member {
  const used = new Set(existing.map((m) => m.tone));
  const tone = MEMBER_TONES.find((t) => !used.has(t)) ?? "sand";
  return {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    name: "",
    email: "",
    tone,
  };
}

function formatPairedAt(createdAt: number): string {
  // ponytail: UTC calendar date avoids browser-TZ drift; upgrade to Household Time Zone when settings expose it.
  return new Date(createdAt).toISOString().slice(0, 10);
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [familyName, setFamilyName] = useState("Family");
  const [members, setMembers] = useState<Member[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [uiScale, setUiScale] = useState<UiScale>(1);
  const [displays, setDisplays] = useState<DisplayRecord[]>([]);
  const [currentDisplayId, setCurrentDisplayId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDisplays() {
    const res = await fetch("/api/displays");
    if (await redirectIfPairingRequired(res)) return;
    if (!res.ok) throw new Error("displays");
    const data = (await res.json()) as {
      displays: DisplayRecord[];
      currentDisplayId: string;
    };
    setDisplays(data.displays);
    setCurrentDisplayId(data.currentDisplayId);
  }

  async function load() {
    const sRes = await fetch("/api/settings");
    if (await redirectIfPairingRequired(sRes)) return;
    const s = (await sRes.json()) as PublicSettings;
    setSettings(s);
    setFamilyName(s.familyName);
    setMembers(s.members);
    setCalendarId(s.calendarId ?? "");
    setUiScale(parseUiScale(s.uiScale));
    await loadDisplays();
    if (s.signedIn) {
      const res = await fetch("/api/calendars");
      if (res.ok) {
        const data = (await res.json()) as { calendars: GoogleCalendar[] };
        setCalendars(data.calendars);
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetch settings once on mount
  useEffect(() => {
    load().catch(() => setError("Could not load settings."));
  }, []);

  async function save() {
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        familyName,
        members,
        calendarId: calendarId || null,
        uiScale,
      }),
    });
    if (!res.ok) {
      setError("Could not save.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    document.documentElement.style.zoom = String(uiScale);
    await load();
  }

  async function mintPairingCode() {
    setError(null);
    const res = await fetch("/api/displays/pairing-code", { method: "POST" });
    if (await redirectIfPairingRequired(res)) return;
    if (!res.ok) {
      setError("Could not create a pairing code.");
      return;
    }
    const data = (await res.json()) as { code: string; expiresAt: number };
    setPairingCode(data.code);
    setPairingExpiresAt(data.expiresAt);
  }

  async function revoke(displayId: string) {
    setError(null);
    const self = displayId === currentDisplayId;
    if (
      !window.confirm(
        self
          ? "Revoke this Display? It will return to pairing immediately."
          : "Revoke this Trusted Display? It will lose household access immediately.",
      )
    ) {
      return;
    }
    const res = await fetch(`/api/displays/${displayId}`, { method: "DELETE" });
    if (self) {
      window.location.assign("/");
      return;
    }
    if (await redirectIfPairingRequired(res)) return;
    if (!res.ok) {
      setError("Could not revoke that Display.");
      return;
    }
    await loadDisplays();
  }

  const patchMember = (id: string, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const pairingMinutesLeft =
    pairingExpiresAt == null
      ? null
      : Math.max(0, Math.ceil((pairingExpiresAt - Date.now()) / 60_000));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-screen)",
      }}
    >
      <AppHeader
        title="Settings"
        actions={
          <Button variant="primary" onClick={save}>
            {saved ? "Saved" : "Save"}
          </Button>
        }
      />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 24px 32px",
          maxWidth: 720,
        }}
      >
        <h2 style={{ font: "var(--type-section)", marginBottom: 12 }}>
          Display
        </h2>
        <label style={{ display: "block", marginBottom: 24 }}>
          <div
            style={{
              font: "var(--type-card-meta)",
              color: "var(--text-muted)",
              marginBottom: 6,
            }}
          >
            Display size
          </div>
          <select
            className="fos-input"
            value={uiScale}
            onChange={(e) => setUiScale(parseUiScale(Number(e.target.value)))}
          >
            {UI_SCALES.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>

        <h2 style={{ font: "var(--type-section)", marginBottom: 12 }}>
          Trusted Displays
        </h2>
        <p
          style={{
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
            marginBottom: 12,
          }}
        >
          Every Trusted Display has equal control. Generate a short-lived code
          to pair another browser profile, or revoke one that should no longer
          access the Household.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displays.map((d) => {
            const isCurrent = d.id === currentDisplayId;
            return (
              <div
                key={d.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: "var(--type-card-meta)" }}>
                    {isCurrent ? "This Display" : "Trusted Display"}
                  </div>
                  <div
                    style={{
                      font: "var(--type-card-meta)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Paired {formatPairedAt(d.createdAt)}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => void revoke(d.id)}>
                  Revoke
                </Button>
              </div>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            marginTop: 14,
            marginBottom: 24,
          }}
        >
          <Button icon="plus" onClick={() => void mintPairingCode()}>
            Generate pairing code
          </Button>
          {pairingCode ? (
            <div
              style={{
                font: "var(--fw-semibold) 22px/1 var(--font-sans)",
                letterSpacing: "0.18em",
                color: "var(--text-title)",
              }}
            >
              {pairingCode}
              {pairingMinutesLeft != null ? (
                <span
                  style={{
                    marginLeft: 10,
                    letterSpacing: "normal",
                    font: "var(--type-card-meta)",
                    color: "var(--text-muted)",
                  }}
                >
                  expires in ~{pairingMinutesLeft} min
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <h2 style={{ font: "var(--type-section)", marginBottom: 12 }}>
          Google Calendar
        </h2>
        {!settings ? (
          <p
            style={{
              font: "var(--type-card-meta)",
              color: "var(--text-muted)",
              marginBottom: 18,
            }}
          >
            Loading
          </p>
        ) : !settings.googleConfigured ? (
          <p
            style={{
              font: "var(--type-card-meta)",
              color: "var(--text-muted)",
              marginBottom: 18,
            }}
          >
            Create an OAuth client in Google Cloud, enable the Calendar API and
            Tasks API, and put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in
            .env.local. Redirect URI:
            http://localhost:3000/api/auth/callback/google
          </p>
        ) : settings.signedIn ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <span style={{ font: "var(--type-card-meta)" }}>Signed in</span>
            <Button
              icon="log-out"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                await load();
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              window.location.href = "/api/auth/google";
            }}
            style={{ marginBottom: 16 }}
          >
            Sign in with Google
          </Button>
        )}
        {settings?.signedIn ? (
          <label style={{ display: "block", marginBottom: 24 }}>
            <div
              style={{
                font: "var(--type-card-meta)",
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              Family calendar
            </div>
            <select
              className="fos-input"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              <option value="">Select a calendar</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}
                  {c.primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <h2 style={{ font: "var(--type-section)", marginBottom: 12 }}>
          Household
        </h2>
        <label style={{ display: "block", marginBottom: 16 }}>
          <div
            style={{
              font: "var(--type-card-meta)",
              color: "var(--text-muted)",
              marginBottom: 6,
            }}
          >
            Family name
          </div>
          <input
            className="fos-input"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
          />
        </label>
        <p
          style={{
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
            marginBottom: 12,
          }}
        >
          Each member's color is stored on Google Calendar events — kids do not
          need an email. Optional email still adds them as an attendee.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map((m) => (
            <div
              key={m.id}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                className="fos-input"
                placeholder="Name"
                value={m.name}
                onChange={(e) => patchMember(m.id, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                className="fos-input"
                placeholder="Email (optional)"
                value={m.email}
                onChange={(e) => patchMember(m.id, { email: e.target.value })}
                style={{ flex: 1.4 }}
              />
              <span
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  flex: "0 0 28px",
                  borderRadius: 8,
                  background: `var(--member-${m.tone})`,
                }}
              />
              <select
                className="fos-input"
                value={m.tone}
                onChange={(e) =>
                  patchMember(m.id, { tone: e.target.value as Member["tone"] })
                }
                style={{ width: 120, flex: "0 0 120px" }}
              >
                {MEMBER_TONES.map((t) => (
                  <option
                    key={t}
                    value={t}
                    disabled={members.some(
                      (x) => x.id !== m.id && x.tone === t,
                    )}
                  >
                    {t} ({TONE_GOOGLE_NAME[t]})
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                onClick={() =>
                  setMembers((ms) => ms.filter((x) => x.id !== m.id))
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button
          icon="plus"
          onClick={() => setMembers((ms) => [...ms, newMember(ms)])}
          style={{ marginTop: 12 }}
        >
          Add member
        </Button>
        {error ? (
          <p
            style={{
              font: "var(--type-card-meta)",
              color: "var(--accent-coral)",
              marginTop: 16,
            }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
