Persistent left rail — every FamilyOS screen has exactly one, 90px wide, 29px icon over a 15px label.

```jsx
<NavRail active="lists" onSelect={setScreen} />
```

Each section has a pastel `tone`; its icon is drawn in the tone's ink. The active item is a soft-tint slab in that tone bleeding to both rail edges, with a 5px ink accent bar and a bold ink label (no pill, no shadow). Rows share the rail height. Import `FAMILYOS_NAV` for the canonical section order and tones.
