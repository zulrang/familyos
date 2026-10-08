---
status: accepted
---

# Today is a composing slice

Today shows one Household date as a Lane of events per Active Member and, for
a chosen member, that member's Tasks beside their day. That is a view across
Calendar and Tasks, and feature slices may not import each other.

## Decision

`src/today/` is a composing slice. It may import any slice; no slice may import
it. `scripts/import-boundaries.ts` enforces both directions.

Today owns only what is its own: the Lane layout of a day and the member
filter. It stores nothing. Events are read and edited through
`useHouseholdCalendar` and tasks through `useTasksWorkspace`, which the
Calendar and Tasks screens also use, so each fact keeps one owner and an edit
made on Today is the same operation as on its home screen.

## Alternatives considered

- Injecting slice components from the app route, as the Tasks member focus
  does with the Calendar day agenda. That works for one read-only panel;
  Today needs both slices' data and all of their actions, so nearly every prop
  would be an injected dependency.
- Building Today inside `calendar` or `tasks`. Either choice makes one feature
  slice depend on the other.
- Moving Calendar and Tasks UI into `shared`. `shared` would then own feature
  rules.

## Consequences

- A second screen that spans feature slices joins `COMPOSING_SLICES` rather
  than weakening the rule between feature slices.
- Calendar and Tasks must keep their screen logic in hooks that a second
  screen can call, not inside one screen component.
