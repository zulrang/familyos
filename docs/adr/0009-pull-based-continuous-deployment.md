---
status: accepted
---

# The household Mac deploys main by polling, into swappable releases

Every commit merged to `main` should reach the wall without anyone pressing
**Update**, and a bad release must be reversible in seconds. The household Mac
sits on home Wi-Fi with no inbound access, and the repository is public.

## Decision

A LaunchAgent on the household Mac polls `origin/main` every two minutes and
deploys the head commit when it differs from the live release and from the last
attempted commit. Nothing pushes to the Mac: no self-hosted GitHub runner, no
tunnel, no deploy secret. Merging a pull request is the deploy action; the PR's
CI run is the gate before it.

Each deploy is a git worktree under `releases/<sha>` with its own
`node_modules` and `.next`. It is built while the previous release keeps
serving, then `releases/current` is repointed and the server restarts. The
deploy waits for `/api/ready`; if the release never answers, `current` returns
to the previous release automatically. `rollback` is the same symlink swap by
hand. The newest three releases are kept. Household data stays in the
checkout's `data/` and secrets in its `.env.local`, shared by every release.

A commit that failed to deploy or was rolled back is not retried; the fix is a
new commit on `main`. Manual `deploy` overrides this for the rare case where
the Mac, not the commit, was at fault.

## Considered Options

- **Self-hosted GitHub Actions runner on the Mac** — rejected. GitHub advises
  against self-hosted runners for public repositories, and it adds a second
  privileged agent to keep alive.
- **Rebuild in place, as `update` did** — rejected. The server had to stop
  before `next build` overwrote `.next`, so a failed build left the wall down,
  and rollback meant another full rebuild.
- **Rollback from the admin page** — deferred. A broken release may not serve
  the admin page at all, so the command line is the reliable path; a UI
  control can follow once the release layout has proven itself.
