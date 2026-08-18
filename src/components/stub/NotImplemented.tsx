import { AppHeader } from "../nav/AppHeader";

export function NotImplemented({ name }: { name: string }) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--surface-screen)",
      }}
    >
      <AppHeader title={title} />
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
        Not yet implemented
      </div>
    </div>
  );
}
