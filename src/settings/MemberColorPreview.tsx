import {
  type ActiveMember,
  checkInkOnFill,
  memberSurface,
  memberTaskPalette,
  onFillInk,
} from "@/members/members";

export function MemberColorPreview({ member }: { member: ActiveMember }) {
  const surface = memberSurface(member.color);
  const tasks = memberTaskPalette(member.color);
  const groups = [
    {
      name: "Calendar & lists",
      swatches: {
        Fill: surface.fill,
        Soft: surface.soft,
        Text: surface.ink,
        Muted: surface.muted,
        "Text on fill": onFillInk(surface.fill),
        Checkmark: checkInkOnFill(surface),
      },
    },
    {
      name: "Tasks",
      swatches: {
        Accent: tasks.accent,
        Panel: tasks.panel,
        Header: tasks.header,
        Text: tasks.ink,
        Control: tasks.control,
        "Text on control": tasks.onControl,
      },
    },
  ];

  return (
    <section
      aria-label={`Color variations for ${member.name || "member"}`}
      style={{ display: "grid", gap: 12, font: "var(--type-card-meta)" }}
    >
      {groups.map(({ name, swatches }) => (
        <section key={name} aria-label={name}>
          <div style={{ color: "var(--text-muted)", marginBottom: 6 }}>
            {name}
          </div>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
              gap: 8,
              margin: 0,
            }}
          >
            {Object.entries(swatches).map(([label, color]) => (
              <div key={label}>
                <div
                  aria-hidden="true"
                  style={{
                    height: 32,
                    borderRadius: 8,
                    background: color,
                    border: "1px solid var(--border-hairline)",
                  }}
                />
                <dt style={{ marginTop: 4 }}>{label}</dt>
                <dd style={{ margin: 0, color: "var(--text-muted)" }}>
                  {color}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </section>
  );
}
