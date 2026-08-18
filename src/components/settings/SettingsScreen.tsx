"use client";

import { useEffect, useState } from "react";
import { TONE_GOOGLE_NAME } from "@/lib/calendar";
import {
  type GoogleCalendar,
  MEMBER_TONES,
  type Member,
  type PublicSettings,
} from "@/lib/types";
import { Button } from "../core/Button";
import { AppHeader } from "../nav/AppHeader";

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

export function SettingsScreen() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [familyName, setFamilyName] = useState("Family");
  const [members, setMembers] = useState<Member[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const s = (await (await fetch("/api/settings")).json()) as PublicSettings;
    setSettings(s);
    setFamilyName(s.familyName);
    setMembers(s.members);
    setCalendarId(s.calendarId ?? "");
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
      }),
    });
    if (!res.ok) {
      setError("Could not save.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    await load();
  }

  const patchMember = (id: string, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

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
            Create an OAuth client in Google Cloud, enable the Calendar API, and
            put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.
            Redirect URI: http://localhost:3000/api/auth/callback/google
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
