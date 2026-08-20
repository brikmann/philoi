#!/usr/bin/env bash
# One-writer lease for git index-mutating commands.
#
# Why: two Claude sessions running git writes concurrently left a stale
# .git/index.lock three separate times, wedging the repo. This hook makes the
# hazard mechanical instead of advisory: the first session to run a git write
# takes a lease, and a second session is blocked until the lease goes stale.
#
# Fail-open by design. Anything unexpected (no repo, unreadable lease, no
# session id) exits 0 and lets the command through -- this must never be the
# reason a commit can't happen.

set -uo pipefail

TTL=900          # lease is stale after 15 min with no git write
LOCK_STALE=120   # index.lock older than this is worth flagging

payload=$(cat 2>/dev/null) || exit 0

# Cheap textual scan -- no jq on this box, and spawning node on every Bash call
# is a tax we don't want. Scanning the raw JSON works because the command shows
# up literally inside the string. False positives are harmless: they only
# refresh a lease we already hold, and only ever block on real contention.
if ! printf '%s' "$payload" | grep -Eq \
  '\bgit\b[^"]{0,160}\b(add|commit|rebase|merge|checkout|switch|reset|cherry-pick|revert|stash|am|apply|restore|rm|mv|pull|clean|gc|update-index|worktree|filter-branch)\b|\beas\b[^"]{0,80}\b(build|update|submit)\b'
then
  exit 0
fi

sid=$(printf '%s' "$payload" \
  | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$sid" ] || exit 0

gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
[ -n "$gitdir" ] || exit 0

lease="$gitdir/claude-writer.lease"
now=$(date +%s)

note=""
if [ -f "$gitdir/index.lock" ]; then
  lock_age=$(( now - $(stat -c %Y "$gitdir/index.lock" 2>/dev/null || echo "$now") ))
  if [ "$lock_age" -ge "$LOCK_STALE" ]; then
    note=" A stale .git/index.lock (${lock_age}s old) is also present -- confirm no git/EAS process is running, then rm -f it."
  fi
fi

if [ -f "$lease" ]; then
  owner=""; ts=0
  read -r owner ts < "$lease" 2>/dev/null || true
  case "$ts" in ''|*[!0-9]*) ts=0 ;; esac
  age=$(( now - ts ))
  if [ -n "$owner" ] && [ "$owner" != "$sid" ] && [ "$age" -lt "$TTL" ]; then
    printf 'BLOCKED by one-writer lease: another Claude session (%s) holds the git writer lease for this repo, last active %ss ago (expires after %ss).%s\n\nDo NOT run this git write. Concurrent writers are what wedged .git/index.lock before. Either wait for that session to finish, or -- if you are certain it is dead -- tell the user, and clear it explicitly with: rm -f %s\n' \
      "${owner:0:8}" "$age" "$TTL" "$note" "$lease" >&2
    exit 2
  fi
fi

printf '%s %s\n' "$sid" "$now" > "$lease" 2>/dev/null || exit 0
exit 0
