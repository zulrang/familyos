# FamilyOS owns Task data, stored in node:sqlite

Calendar and Lists established the pattern that Google is the source of truth
and FamilyOS keeps no local domain database. Tasks breaks that pattern
deliberately: Task Definitions and Task events live in a FamilyOS-owned SQLite
store (the built-in `node:sqlite` module, one gitignored file under `data/`).
This is the first local domain data beyond Household Configuration.

## Considered Options

- **Google Tasks as the store** — rejected. Rotation order, Windows,
  append-only events, and retire-and-replace definition versioning do not map
  onto tasklist rows, and storing wall-only structure in a personal Google
  account leaks product internals into user data.
- **JSON files, like Household Configuration** — rejected. The Task model's
  invariants (a unique `(task, window, kind)` event key, transactional
  retire-and-replace edits) want real constraints and transactions, not
  read-modify-write on a file.
- **better-sqlite3 or another SQLite dependency** — rejected. Node 24's
  built-in `node:sqlite` covers unique constraints, transactions, and
  synchronous access with zero new dependencies.

## Consequences

- The server gains its first database file; backups of `data/` now cover
  domain data, not just configuration and caches.
- The "Google is authoritative, cache is read-only" availability rules in the
  SSD do not apply to Tasks: the server is the authority, so Tasks stay
  writable whenever the server is up.
- Companion surfaces someday syncing Tasks will sync against FamilyOS, not
  against a Google API.
