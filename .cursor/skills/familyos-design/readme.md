# FamilyOS Design System

FamilyOS is an open-source **command center for family tasking, scheduling, and organization** — a wall-mounted touch display (plus companion surfaces) where a household shares one calendar, one set of lists, and one set of chores. Everything in the interface answers two questions at a glance, from across a kitchen: *what happens next* and *whose is it*.

## Sources used

Tokens, type, and component contracts in this skill are the visual language for the wall display. Production calendar UI lives in `src/components/calendar/` and is the reference for Calendar. Lists and Tasks exist here as kit screens only until those product surfaces ship.

---

## Content fundamentals

The product's voice is **plain, warm, and domestic** — it names real household things and gets out of the way. There is no marketing voice anywhere in the UI.

- **Nouns over verbs, and short.** Screen and section names are single words: *Calendar, Lists, Tasks, Rewards, Meals, Recipes, Photos, Sleep, Settings*. Sections inside a day are *Morning*, *Chores*.
- **Title Case for anything the product names**, sentence-ish case for what a family types. Product chrome: "Add section", "Schedule", "Filter", "Today". User content keeps the family's own phrasing and quirks: "Pet sitter (Allie?)", "Undies x7", "Dog's Big Bath Day!", "Travel Bucket Li…" (truncated, not rewritten).
- **Neither "I" nor "you".** Labels are impersonal and imperative at most ("Add section"). Ownership is expressed by *name*, never by pronoun: the calendar chips read **Dad, Ellie, Harper, Luke, Mom** — first names and family roles, never "You" or "Me".
- **Numbers are compact and unlabeled.** "1/20", "3/20", "48 days", "80°", "11:20 AM", "7 AM". No "of", no "degrees", no "remaining".
- **Exclamation marks belong to the family, not the product.** "Emma's Birthday Party!" is user content; product copy never exclaims.
- **Emoji appear only inside user content** — a food emoji on a grocery row, a flag on a travel list, a palm tree on the Vacation chip. Never in nav labels, buttons, headings, or empty states. Do not add decorative emoji to UI chrome.
- **Empty states name the action**, e.g. the greyed "Add section" footer sitting at the bottom of a list panel.

Tone in one line: *a fridge whiteboard that happens to be a screen.*

---

## Visual foundations

**Overall feel.** Bright white screens, cool grey-blue chrome, and pastel content blocks. Colour is *semantic*, not decorative: each family member owns a pastel and it appears everywhere their stuff appears. The interface is almost entirely flat — separation comes from tint and whitespace, not from strokes or shadows.

**Colour.** Six member pastels (`--member-teal / blush / lilac / sage / coral / sand`), each with a `-soft` variant for panels and idle rows and an `-ink` variant for text on tint. Neutrals are a cool, faintly blue grey ramp — the rail is `#eef4f8`, screens are pure white, body text is `#2e3a45` (never pure black). Saturated colour is rationed to four jobs: the blue add button (`--brand-blue #1878c8`), the coral *today* badge and now-line, amber/teal/lilac count badges echoing their list's tint, and nothing else. No brand gradient anywhere. Backgrounds are flat white — no imagery, no patterns, no texture, no full-bleed photography inside the UI (the only photos are family member avatars).

**Type.** Two families. A warm display serif for anything that names something — screen titles ("Miller Family"), day labels ("Wed 19"), list titles ("Grocery List"), section headings ("Morning"). A rounded humanist sans for everything functional — event titles (bold), times (semibold, dimmed), rows, nav labels, badges. Serif is never used for data; sans is never used for headings. Nothing sits below 13px because the display is read from 6–10 feet: 34px screen titles, 26px day labels, 22px list titles, 17px event titles, 15px rows, 13px nav labels and times.

**Spacing & layout.** Tight, dense, and column-driven. The 74px icon rail is fixed and never collapses. Screens are one header row, an optional filter strip, then an equal-width column grid that fills the remaining height (5 day columns, 4 list panels, 4 member columns). Stacked rows sit 6px apart; list rows are 11px/14px padded; panels are 10–14px padded. Content scrolls inside columns, chrome never moves.

**Corners.** Rows 10px, event blocks and cards 14px, panels and member headers 18px, every control (buttons, chips, badges, checkboxes-on-tasks, FAB) fully round. Nothing in the UI has a sharp 0px corner except the rail and grid lines.

**Borders & shadows.** Hairline `#e3ebf1` for calendar grid lines and white pill buttons; **content blocks have no border at all**. Elevation is nearly invisible: `0 1px 2px` on pills, `0 2px 8px` on floating panels. The one real shadow is the FAB's blue glow. No inner shadows, no protection gradients, no glassmorphism, no blur, no transparency effects — the only opacity in the system is the 55% dimming of a completed list row and 50% on a deselected member chip.

**The multi-member stripe.** The system's one signature graphic: when an item belongs to several people, its fill becomes soft diagonal pastel bands (`--stripe-multi`, ~115°, 34px bands) instead of a single tint. Used on event cards and all-day bands.

**States.**
- *Hover* — a barely-there darkening (`--hover-tint`, 4% ink); no colour changes, no lifts.
- *Press* — a 3% scale-down (`--press-scale: .97`); the FAB darkens to `--brand-blue-press`.
- *Selected / active* — nav: a **white slab** bleeding to both rail edges (no pill, no accent bar). Tabs: a ringed circle in the member tint. Chips: full soft tint at 100% opacity, deselected drops to sunken grey at 50%.
- *Complete* — a task row deepens from `-soft` to the full member tint and its circle fills with a check; a list row keeps its tint but drops to 55% opacity with a strike-through.

**Motion.** Restrained and short: 120–260ms, `cubic-bezier(.4,0,.2,1)` for state changes and `cubic-bezier(.2,.7,.3,1)` for progress fills. Fades and tint cross-fades only — no bounce, no spring, no slide-in choreography. Nothing animates on load; nothing loops.

**Imagery.** Only real family photos, cropped to circles with a 2px white ring. Warm, un-filtered, no grain, no duotone. Nothing illustrated — this product ships no illustration set in the screens supplied.

---

## Iconography

- **Outline glyphs only**, ~1.5–2px stroke, rounded caps, no fills, no two-tone, no duotone — the rail's calendar / list / check / star / utensils / book / image / moon / gear set, plus header glyphs (columns, eye-off, chevrons, plus) and task tabs (sunrise, sun, moon, sparkles).
- **No icon font or SVG sprite was supplied with the source**, so this system substitutes **[Lucide](https://lucide.dev) (v0.544, via unpkg CDN)** — the closest match to the source's stroke weight and rounded-cap style. ⚠️ *Substitution — flagged for review.* If FamilyOS has its own icon set, drop the SVGs into `assets/icons/` and repoint `components/core/Icon.jsx`.
- Icons load as a CSS mask so they inherit `currentColor`; see `components/core/Icon.prompt.md`.
- Sizes: 22px in the rail, 18–20px in buttons and tabs, 13px inside stat pills, ~28px in the FAB.
- **Emoji are content, not iconography** (grocery items, country flags, the palm tree on the Vacation chip). Unicode characters are never used as UI icons; the only non-icon glyph in chrome is the degree sign in "80°".
- **No logo file was supplied**, so no mark was drawn. Wherever a logo would go, set the wordmark **FamilyOS** in the display serif (see the Brand → Wordmark card); the rail's top tile uses a single letter placeholder.

---

## Index

| Path | What's there |
|---|---|
| `styles.css` | Root entry — `@import` list only |
| `tokens/` | `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `shadows.css`, `motion.css`, `base.css` |
| `guidelines/` | 17 foundation specimen cards (Colors, Type, Spacing, Brand) |
| `components/core/` | `Icon`, `Button`, `IconButton`, `Fab`, `Badge`, `Avatar`, `AvatarStack`, `Checkbox`, `StatPill`, `ProgressBar` |
| `components/nav/` | `NavRail` (+ `FAMILYOS_NAV`), `AppHeader` |
| `components/calendar/` | `EventCard`, `AllDayBar`, `DayHeader`, `MemberChip`, `TimeGutter`, `NowLine` |
| `components/lists/` | `ListPanel`, `ListRow` |
| `components/tasks/` | `MemberColumn`, `TimeOfDayTabs`, `TaskRow`, `SectionLabel` |
| `ui_kits/wall-display/` | Interactive recreation of Calendar, Lists and Tasks — see its README |
| `thumbnail.html` | Homepage tile |
| `SKILL.md` | Agent-skill entry point |

Each component directory holds `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md`, and one `@dsCard` HTML showing its states.

### Intentional additions
- **`Icon`** — the source has no icon component to copy, but every other component needs one glyph API. Thin wrapper over the substituted Lucide set.
- **`NowLine`, `TimeGutter`** — split out of the calendar grid so the grid itself isn't a component.

Nothing else was invented: there is no Toast, Modal, Tooltip, Tabs-bar, Select, or Input in this system because none appears on the wall calendar.

---

## Substitutions & gaps — please review

1. **Fonts.** No binaries were supplied. Nearest Google Fonts matches are in use: **Newsreader** for the display serif (source looks like a warmer, softer-serifed face such as Recoleta) and **Nunito Sans** for the UI sans. Please send the real font files or names.
2. **Icons.** Lucide via CDN, as noted above.
3. **Logo.** None supplied; wordmark set in type. No mark was drawn.
4. **Avatars.** No photo assets; `Avatar` falls back to a member initial on their tint.
5. **Unseen sections.** Rewards, Meals, Recipes, Photos, Sleep and Settings appear in the rail but have no product screens yet.
6. **Exact metrics** are in the token files; check the running calendar if something looks off.
