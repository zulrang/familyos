"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/calendar";
import { redirectIfPairingRequired } from "@/lib/display-client";
import { splitLeadingEmoji } from "@/lib/list-text";
import type {
  MemberTone,
  PublicSettings,
  TaskItem,
  TaskList,
} from "@/lib/types";
import { Button } from "../core/Button";
import { Fab } from "../core/Fab";
import { IconButton } from "../core/IconButton";
import { AppHeader } from "../nav/AppHeader";
import { ListPanel } from "./ListPanel";
import { ListRow } from "./ListRow";

const LIST_TONES: MemberTone[] = [
  "sand",
  "blush",
  "lilac",
  "teal",
  "sage",
  "coral",
];

function headerDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now ? formatClock(now) : null;
}

type Sheet =
  | { kind: "create"; title: string }
  | { kind: "edit"; id: string; title: string; confirmDelete: boolean };

export function ListsScreen() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [configVersion, setConfigVersion] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetch once, then poll
  useEffect(() => {
    load().catch(() => setError("Could not load lists."));
    const poll = setInterval(() => {
      load().catch(() => {});
    }, 60_000);
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);

  async function load() {
    const sRes = await fetch("/api/settings");
    if (await redirectIfPairingRequired(sRes)) return;
    const s = (await sRes.json()) as PublicSettings;
    setSettings(s);
    setConfigVersion(s.configVersion);
    if (!s.signedIn) {
      setLists([]);
      return;
    }
    const res = await fetch("/api/lists");
    if (await redirectIfPairingRequired(res)) return;
    if (res.status === 401) {
      setLists([]);
      setNeedsReauth(true);
      return;
    }
    if (!res.ok) {
      setError("Could not load lists.");
      return;
    }
    const data = (await res.json()) as { lists: TaskList[] };
    setLists(data.lists);
    setNeedsReauth(false);
    setError(null);
  }

  function patchItem(listId: string, itemId: string, next: Partial<TaskItem>) {
    setLists((ls) =>
      ls.map((l) =>
        l.id !== listId
          ? l
          : {
              ...l,
              items: l.items.map((i) =>
                i.id === itemId ? { ...i, ...next } : i,
              ),
            },
      ),
    );
  }

  async function toggle(listId: string, item: TaskItem) {
    const done = !item.done;
    patchItem(listId, item.id, { done });
    const res = await fetch(
      `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      },
    );
    if (await redirectIfPairingRequired(res)) return;
    if (res.status === 401) {
      patchItem(listId, item.id, { done: item.done });
      setNeedsReauth(true);
      return;
    }
    if (!res.ok) patchItem(listId, item.id, { done: item.done });
  }

  async function addItem(listId: string) {
    const title = (drafts[listId] ?? "").trim();
    if (!title) return;
    const res = await fetch(`/api/lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (await redirectIfPairingRequired(res)) return;
    if (res.status === 401) {
      setNeedsReauth(true);
      return;
    }
    if (!res.ok) {
      setError("Could not add item.");
      return;
    }
    const data = (await res.json()) as { item: TaskItem };
    setDrafts((d) => ({ ...d, [listId]: "" }));
    setLists((ls) =>
      ls.map((l) =>
        l.id !== listId ? l : { ...l, items: [data.item, ...l.items] },
      ),
    );
  }

  async function clearChecked(listId: string) {
    const res = await fetch(`/api/lists/${encodeURIComponent(listId)}/clear`, {
      method: "POST",
    });
    if (await redirectIfPairingRequired(res)) return;
    if (res.status === 401) {
      setNeedsReauth(true);
      return;
    }
    if (!res.ok) {
      setError("Could not clear checked items.");
      return;
    }
    setLists((ls) =>
      ls.map((l) =>
        l.id !== listId ? l : { ...l, items: l.items.filter((i) => !i.done) },
      ),
    );
  }

  async function saveSheet() {
    if (!sheet) return;
    const title = sheet.title.trim();
    if (!title) return;
    setBusy(true);
    try {
      if (sheet.kind === "create") {
        const res = await fetch("/api/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, expectedVersion: configVersion }),
        });
        if (res.status === 409) {
          await load();
          setError(
            "Lists changed on another Display. Reloaded — try adding again.",
          );
          return;
        }
        if (!res.ok) {
          setError("Could not create list.");
          return;
        }
        const data = (await res.json()) as { configVersion?: number };
        if (typeof data.configVersion === "number") {
          setConfigVersion(data.configVersion);
        }
      } else {
        const res = await fetch(`/api/lists/${encodeURIComponent(sheet.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) {
          setError("Could not rename list.");
          return;
        }
      }
      setSheet(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeList(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: configVersion }),
      });
      if (res.status === 409) {
        await load();
        setError(
          "Lists changed on another Display. Reloaded — try removing again.",
        );
        return;
      }
      if (!res.ok) {
        setError("Could not remove list.");
        return;
      }
      const data = (await res.json()) as { configVersion?: number };
      if (typeof data.configVersion === "number") {
        setConfigVersion(data.configVersion);
      }
      setSheet(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const signedIn = Boolean(settings?.signedIn) && !needsReauth;
  const banner = !settings
    ? null
    : !settings.googleConfigured
      ? "Add Google credentials in .env.local, then sign in under Settings."
      : !settings.signedIn || needsReauth
        ? "Sign in with Google under Settings to load lists. If you already signed in, sign out and back in to grant Tasks access."
        : error;

  const many = lists.length > 4;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "var(--surface-screen)",
        position: "relative",
      }}
    >
      <AppHeader title={headerDate(now)} time={<LiveClock />} />
      {banner ? (
        <div
          style={{
            padding: "0 24px 12px",
            font: "var(--type-card-meta)",
            color: "var(--text-muted)",
          }}
        >
          {banner}
        </div>
      ) : null}
      {signedIn && lists.length === 0 && !banner ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "var(--type-section)",
            color: "var(--text-faint)",
          }}
        >
          Tap + to add a list, or select lists under Settings
        </div>
      ) : null}
      {signedIn && lists.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: many
              ? `repeat(${lists.length}, minmax(220px, 1fr))`
              : "repeat(4, 1fr)",
            gap: 14,
            padding: "4px 24px 24px",
            flex: 1,
            minHeight: 0,
            overflowX: many ? "auto" : "hidden",
            overflowY: "hidden",
          }}
        >
          {lists.map((list, i) => {
            const tone = LIST_TONES[i % LIST_TONES.length];
            const remaining = list.items.filter((it) => !it.done).length;
            return (
              <ListPanel
                key={list.id}
                title={list.title}
                count={remaining}
                tone={tone}
                onTitleClick={() =>
                  setSheet({
                    kind: "edit",
                    id: list.id,
                    title: list.title,
                    confirmDelete: false,
                  })
                }
                footer={
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        addItem(list.id);
                      }}
                    >
                      <input
                        className="fos-input"
                        placeholder="Add item"
                        value={drafts[list.id] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [list.id]: e.target.value,
                          }))
                        }
                      />
                    </form>
                    {list.items.some((it) => it.done) ? (
                      <button
                        type="button"
                        onClick={() => clearChecked(list.id)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--text-faint)",
                          font: "var(--type-card-meta)",
                          cursor: "pointer",
                          padding: "4px 2px",
                          textAlign: "left",
                        }}
                      >
                        Clear checked
                      </button>
                    ) : null}
                  </>
                }
              >
                {list.items.map((item) => {
                  const { emoji, label } = splitLeadingEmoji(item.title);
                  return (
                    <ListRow
                      key={item.id}
                      label={label}
                      emoji={emoji}
                      checked={item.done}
                      tone={tone}
                      onToggle={() => toggle(list.id, item)}
                    />
                  );
                })}
              </ListPanel>
            );
          })}
        </div>
      ) : null}
      {signedIn ? (
        <Fab
          label="Add list"
          onClick={() => setSheet({ kind: "create", title: "" })}
        />
      ) : null}
      {sheet ? (
        <ListSheet
          sheet={sheet}
          busy={busy}
          onChange={setSheet}
          onClose={() => setSheet(null)}
          onSave={saveSheet}
          onDelete={
            sheet.kind === "edit" ? () => removeList(sheet.id) : undefined
          }
        />
      ) : null}
    </div>
  );
}

function ListSheet({
  sheet,
  busy,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  sheet: Sheet;
  busy: boolean;
  onChange: (s: Sheet) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      />
      <div
        style={{
          position: "relative",
          width: 420,
          maxWidth: "calc(100% - 48px)",
          background: "var(--surface-screen)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-panel)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ font: "var(--type-section)", flex: 1 }}>
            {sheet.kind === "create" ? "New list" : "List"}
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <input
          className="fos-input"
          placeholder="Name"
          value={sheet.title}
          onChange={(e) => onChange({ ...sheet, title: e.target.value })}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {sheet.kind === "edit" && onDelete ? (
            sheet.confirmDelete ? (
              <Button
                disabled={busy}
                onClick={onDelete}
                style={{ marginRight: "auto" }}
              >
                Remove from wall?
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() => onChange({ ...sheet, confirmDelete: true })}
                style={{ marginRight: "auto" }}
              >
                Remove
              </Button>
            )
          ) : null}
          <Button variant="primary" disabled={busy} onClick={onSave}>
            {sheet.kind === "create" ? "Add" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
