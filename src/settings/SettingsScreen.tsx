"use client";

import { useEffect, useState } from "react";
import {
  activeMembers,
  LEGACY_TONE_COLORS,
  legacyToneForColor,
  MAX_ACTIVE_MEMBERS,
  type Member,
  retireMember,
} from "@/members/members";
import type { PublicSettings } from "@/settings/types";
import { AppHeader } from "@/shared/AppHeader";
import { redirectIfPairingRequired } from "@/shared/display-client";
import { MEMBER_TONES } from "@/shared/member-tone";
import { isIanaTimeZone } from "@/shared/time";
import { Button } from "@/shared/ui/Button";
import { parseUiScale, UI_SCALES, type UiScale } from "@/shared/ui-scale";

const HOUSEHOLD_TIME_ZONES = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

type GoogleCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
};

type GoogleTasklist = {
  id: string;
  title: string;
};

type DisplayRecord = {
  id: string;
  createdAt: number;
  revokedAt: number | null;
};

function newMember(existing: Member[]): Member {
  const used = new Set(activeMembers(existing).map((m) => m.color));
  const color =
    Object.values(LEGACY_TONE_COLORS).find((c) => !used.has(c)) ??
    LEGACY_TONE_COLORS.sand;
  return {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    name: "",
    status: "active",
    color,
  };
}

function formatPairedAt(createdAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(createdAt));
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [tasklists, setTasklists] = useState<GoogleTasklist[]>([]);
  const [familyName, setFamilyName] = useState("Family");
  const [members, setMembers] = useState<Member[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [listIds, setListIds] = useState<string[]>([]);
  const [timeZone, setTimeZone] = useState("");
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

  async function applyPublicSettings(s: PublicSettings) {
    setSettings(s);
    setFamilyName(s.familyName);
    setMembers(s.members);
    setCalendarId(s.calendarId ?? "");
    setListIds(s.listIds ?? []);
    setTimeZone(s.timeZone);
    setUiScale(parseUiScale(s.uiScale));
  }

  async function load() {
    const sRes = await fetch("/api/settings");
    if (await redirectIfPairingRequired(sRes)) return;
    const s = (await sRes.json()) as PublicSettings;
    await applyPublicSettings(s);
    await loadDisplays();
    if (s.signedIn) {
      const [calRes, listsRes] = await Promise.all([
        fetch("/api/calendars"),
        fetch("/api/tasklists"),
      ]);
      if (calRes.ok) {
        const data = (await calRes.json()) as { calendars: GoogleCalendar[] };
        setCalendars(data.calendars);
      }
      if (listsRes.ok) {
        const data = (await listsRes.json()) as {
          tasklists: GoogleTasklist[];
        };
        setTasklists(data.tasklists);
      }
    } else {
      setCalendars([]);
      setTasklists([]);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetch settings once on mount
  useEffect(() => {
    load().catch(() => setError("Could not load settings."));
  }, []);

  async function save() {
    setError(null);
    const householdDirty =
      !settings ||
      familyName !== settings.familyName ||
      (calendarId || null) !== settings.calendarId ||
      JSON.stringify(listIds) !== JSON.stringify(settings.listIds) ||
      timeZone !== settings.timeZone ||
      JSON.stringify(members) !== JSON.stringify(settings.members);
    const scaleDirty = !settings || uiScale !== settings.uiScale;

    if (householdDirty) {
      const householdRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName,
          members,
          calendarId: calendarId || null,
          listIds,
          timeZone,
          expectedVersion: settings?.configVersion,
        }),
      });
      if (householdRes.status === 409) {
        const newer = (await householdRes.json()) as PublicSettings;
        await applyPublicSettings(newer);
        setError(
          "Settings changed on another Display. Reloaded the current values — review and save again.",
        );
        return;
      }
      if (!householdRes.ok) {
        setError("Could not save.");
        return;
      }
      const savedHousehold = (await householdRes.json()) as PublicSettings;
      await applyPublicSettings(savedHousehold);
    }

    if (scaleDirty) {
      // Scale is Display-local — never bundle it into Household Configuration writes.
      const scaleRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uiScale }),
      });
      if (!scaleRes.ok) {
        setError("Could not save display size.");
        return;
      }
      const savedScale = (await scaleRes.json()) as PublicSettings;
      setSettings(savedScale);
      setUiScale(parseUiScale(savedScale.uiScale));
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    document.documentElement.style.zoom = String(uiScale);
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

  const patchMember = (id: string, patch: { name?: string; color?: string }) =>
    setMembers((ms) =>
      ms.map((m) => {
        if (m.id !== id || m.status !== "active") return m;
        return {
          id: m.id,
          name: patch.name ?? m.name,
          status: "active" as const,
          color: patch.color ?? m.color,
        };
      }),
    );

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
                    Paired{" "}
                    {timeZone ? formatPairedAt(d.createdAt, timeZone) : ""}
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
        {settings?.signedIn ? (
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                font: "var(--type-card-meta)",
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              Household Lists
            </div>
            <p
              style={{
                font: "var(--type-card-meta)",
                color: "var(--text-muted)",
                marginBottom: 10,
              }}
            >
              Only selected Google tasklists appear on the Lists wall. Unselect
              to hide a list without deleting it in Google.
            </p>
            {tasklists.length === 0 ? (
              <p
                style={{
                  font: "var(--type-card-meta)",
                  color: "var(--text-faint)",
                }}
              >
                No Google tasklists found on this account.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tasklists.map((t) => {
                  const checked = listIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        font: "var(--type-card-meta)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setListIds((ids) =>
                            checked
                              ? ids.filter((id) => id !== t.id)
                              : [...ids, t.id],
                          );
                        }}
                      />
                      {t.title}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
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
        {timeZone ? (
          <label style={{ display: "block", marginBottom: 16 }}>
            <div
              style={{
                font: "var(--type-card-meta)",
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              Household Time Zone
            </div>
            <select
              className="fos-input"
              value={timeZone}
              onChange={(e) => {
                if (isIanaTimeZone(e.target.value)) setTimeZone(e.target.value);
              }}
            >
              {HOUSEHOLD_TIME_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p
          style={{
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
            marginBottom: 12,
          }}
        >
          Each Active Member has a FamilyOS color. Retiring frees the color and
          keeps the person on past events.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map((m) =>
            m.status === "retired" ? (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  opacity: 0.65,
                }}
              >
                <input
                  className="fos-input"
                  value={m.name}
                  disabled
                  style={{ flex: 1 }}
                />
                <span
                  style={{
                    font: "var(--type-card-meta)",
                    color: "var(--text-muted)",
                    flex: "0 0 auto",
                  }}
                >
                  Retired
                </span>
              </div>
            ) : (
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
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    flex: "0 0 28px",
                    borderRadius: 8,
                    background:
                      legacyToneForColor(m.color) != null
                        ? `var(--member-${legacyToneForColor(m.color)})`
                        : m.color,
                  }}
                />
                <select
                  className="fos-input"
                  value={legacyToneForColor(m.color) ?? ""}
                  onChange={(e) => {
                    const tone = e.target
                      .value as (typeof MEMBER_TONES)[number];
                    patchMember(m.id, {
                      color: LEGACY_TONE_COLORS[tone],
                    });
                  }}
                  style={{ width: 120, flex: "0 0 120px" }}
                >
                  {MEMBER_TONES.map((t) => (
                    <option
                      key={t}
                      value={t}
                      disabled={members.some(
                        (x) =>
                          x.status === "active" &&
                          x.id !== m.id &&
                          x.color === LEGACY_TONE_COLORS[t],
                      )}
                    >
                      {t}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setMembers((ms) => retireMember(ms, m.id) ?? ms)
                  }
                >
                  Retire
                </Button>
              </div>
            ),
          )}
        </div>
        <Button
          icon="plus"
          disabled={activeMembers(members).length >= MAX_ACTIVE_MEMBERS}
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
