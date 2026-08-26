#!/usr/bin/env bash
# ponytail: regex scan only; upgrade path is gitleaks/detect-secrets if patterns grow.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# High-confidence patterns — not test placeholders like "test-secret" or "secret-access".
PATTERN='GOCSPX-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|ya29\.[0-9A-Za-z_-]{20,}|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|[0-9]{12,}-[a-z0-9]+\.apps\.googleusercontent\.com'

scan_range() {
  local range=$1
  git rev-parse --verify -q "${range}^{commit}" >/dev/null 2>&1 || return 0
  local hits
  hits=$(
    git grep -E "$PATTERN" "$range" -- \
      ':!node_modules' \
      ':!pnpm-lock.yaml' \
      ':!scripts/scan-secrets.sh' \
      2>/dev/null || true
  )
  if [[ -n "$hits" ]]; then
    printf 'scan-secrets: likely secret in %s\n' "$range" >&2
    printf '%s\n' "$hits" >&2
    return 1
  fi
  return 0
}

scan_pre_push() {
  local failed=0
  while read -r _local_ref local_sha _remote_ref remote_sha; do
    [[ -z "${local_sha:-}" ]] && continue
    [[ "$local_sha" =~ ^0+$ ]] && continue
    local range
    if [[ "${remote_sha:-}" =~ ^0+$ ]] || [[ -z "${remote_sha:-}" ]]; then
      range="$local_sha"
    else
      range="$remote_sha..$local_sha"
    fi
    scan_range "$range" || failed=1
  done
  return "$failed"
}

scan_ahead_of_main() {
  local base
  if git rev-parse --verify -q origin/main >/dev/null 2>&1; then
    base="origin/main..HEAD"
  else
    base="HEAD"
  fi
  scan_range "$base"
}

self_check() {
  echo 'GOCSPX-deadbeef0123' | grep -Eq "$PATTERN" || {
    echo 'scan-secrets --check: expected pattern match' >&2
    return 1
  }
  echo 'secret-access' | grep -Eq "$PATTERN" && {
    echo 'scan-secrets --check: false positive on test placeholder' >&2
    return 1
  }
  echo 'scan-secrets --check: ok'
}

case "${1:-}" in
  --check)
    self_check
    ;;
  --pre-push)
    scan_pre_push
    ;;
  *)
    scan_ahead_of_main
    ;;
esac
