"use client";

import {
  applyWhoSelection,
  type EventWho,
  parseWhoSelect,
  showSeveralOption,
  whoSelectValue,
} from "@/calendar/event-who";
import type { SeriesScope } from "@/calendar/types";
import {
  LEGACY_TONE_COLORS,
  type Member,
  memberSurface,
} from "@/members/members";
import { Button } from "@/shared/ui/Button";
import { IconButton } from "@/shared/ui/IconButton";
import { MemberChip } from "./MemberChip";

export type EventDraft = {
  id?: string;
  title: string;
  allDay: boolean;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  who: EventWho;
  memberIds: string[];
  recurringEventId?: string;
  scope: SeriesScope;
};

const SCOPES: { id: SeriesScope; label: string }[] = [
  { id: "this", label: "This event" },
  { id: "following", label: "This and following events" },
  { id: "all", label: "All events" },
];

export function EventSheet({
  draft,
  members,
  busy,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: EventDraft;
  members: Member[];
  busy: boolean;
  onChange: (d: EventDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const set = (patch: Partial<EventDraft>) => onChange({ ...draft, ...patch });
  const setWho = (who: EventWho) =>
    set(applyWhoSelection(who, members, draft.memberIds));
  const assignable = members.filter((m) => m.status === "active");
  // Historical Event Participants (Retired) stay visible but not newly choosable.
  const historical = members.filter(
    (m) => m.status === "retired" && draft.memberIds.includes(m.id),
  );
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
          width: 480,
          maxWidth: "calc(100% - 48px)",
          maxHeight: "calc(100% - 48px)",
          overflow: "auto",
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
            {draft.id ? "Event" : "New Event"}
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <input
          className="fos-input"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            font: "var(--type-card-meta)",
          }}
        >
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => set({ allDay: e.target.checked })}
          />
          All day
        </label>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          <input
            className="fos-input"
            type="date"
            value={draft.date}
            onChange={(e) =>
              set({
                date: e.target.value,
                endDate: draft.allDay ? draft.endDate : e.target.value,
              })
            }
            style={{ gridColumn: draft.allDay ? undefined : "1 / -1" }}
          />
          {draft.allDay ? (
            <input
              className="fos-input"
              type="date"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          ) : (
            <>
              <input
                className="fos-input"
                type="time"
                value={draft.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
              />
              <input
                className="fos-input"
                type="time"
                value={draft.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
              />
            </>
          )}
        </div>
        <label style={{ display: "block" }}>
          <div
            style={{
              font: "var(--type-card-meta)",
              color: "var(--text-muted)",
              marginBottom: 6,
            }}
          >
            Who
          </div>
          <select
            className="fos-input"
            value={whoSelectValue(draft.who)}
            onChange={(e) => setWho(parseWhoSelect(e.target.value))}
          >
            <option value="none">Nobody</option>
            {assignable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || "Unnamed"}
              </option>
            ))}
            {historical.map((m) => (
              <option key={m.id} value={m.id} disabled>
                {m.name || "Unnamed"} (retired)
              </option>
            ))}
            {showSeveralOption(assignable.length, historical.length, draft) ? (
              <option value="several">Several people</option>
            ) : null}
          </select>
        </label>
        {draft.who.kind === "several" ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {assignable.map((m) => (
              <MemberChip
                key={m.id}
                name={m.name}
                surface={memberSurface(m.color)}
                active={draft.memberIds.includes(m.id)}
                onClick={() =>
                  set({
                    memberIds: draft.memberIds.includes(m.id)
                      ? draft.memberIds.filter((id) => id !== m.id)
                      : [...draft.memberIds, m.id],
                  })
                }
                style={{ flex: "0 0 auto" }}
              />
            ))}
            {historical.map((m) => (
              <MemberChip
                key={m.id}
                name={`${m.name || "Unnamed"} (retired)`}
                surface={memberSurface(LEGACY_TONE_COLORS.sand)}
                active
                style={{ flex: "0 0 auto", opacity: 0.85 }}
              />
            ))}
          </div>
        ) : null}
        {draft.recurringEventId ? (
          <fieldset
            style={{
              border: "none",
              padding: 0,
              minWidth: 0,
              display: "grid",
              gap: 6,
            }}
          >
            <legend
              style={{
                font: "var(--type-card-meta)",
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              Apply to
            </legend>
            {SCOPES.map((s) => {
              const on = draft.scope === s.id;
              return (
                <label
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minHeight: "var(--hit-min)",
                    padding: "0 12px",
                    borderRadius: "var(--radius-sm)",
                    background: on ? "var(--surface-sunken)" : "transparent",
                    font: "var(--type-card-meta)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="series-scope"
                    value={s.id}
                    checked={on}
                    disabled={busy}
                    onChange={() => set({ scope: s.id })}
                  />
                  {s.label}
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 8,
          }}
        >
          {onDelete ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={onDelete}
              style={{ marginRight: "auto" }}
            >
              Delete
            </Button>
          ) : null}
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
