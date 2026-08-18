Persistent left rail — every FamilyOS screen has exactly one, 74px wide, icon over a 13px label.

```jsx
<NavRail active="lists" onSelect={setScreen} />
```

The active item is a white slab bleeding to both rail edges (no pill, no accent bar). Import `FAMILYOS_NAV` for the canonical section order.
