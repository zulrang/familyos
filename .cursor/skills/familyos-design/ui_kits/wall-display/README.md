# UI kit — FamilyOS wall display

A kit for the wall display: **Calendar** (week view), **Lists** (four list columns), **Tasks** (per-member chore columns). Everything is composed from this design system's components; nothing is re-implemented locally. Production Calendar is `src/components/calendar/`; Lists and Tasks here are kit-only until those screens ship.

| File | What it is |
|---|---|
| `index.html` | Interactive shell — rail switches screens, chips filter the calendar, checkboxes toggle, FAB shows a stub |
| `App.jsx` | Rail + screen router + stub toast |
| `CalendarScreen.jsx` | Week grid, all-day bands, member filter chips, now line |
| `ListsScreen.jsx` | Four `ListPanel`s of `ListRow`s |
| `TasksScreen.jsx` | Four `MemberColumn`s with Morning / Chores sections |
| `data.js` | Fake family, events, lists and chores for the kit |

## Known gaps
The kit only implements Calendar, Lists and Tasks. Rewards, Meals, Recipes, Photos, Sleep and Settings exist in the rail but are left blank with a disclaimer rather than invented. Member avatars fall back to tinted initials — no photo assets were supplied.
