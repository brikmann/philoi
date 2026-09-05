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
#
# A false positive is NOT harmless once several sessions are live. The first
# version scanned the whole raw payload for "git ... <verb>" anywhere in the
# string, so `git stash list` took the writer lease and blocked another session
# for fifteen minutes -- and so would `git merge-base`, `git show stash@{0}`,
# and any command whose *description* happened to say "commit". Reads must not
# take a lease. The command is therefore parsed per shell segment now: the git
# subcommand is matched as a token, and the read-only forms are exempt.

set -uo pipefail

TTL=900          # lease is stale after 15 min with no git write
LOCK_STALE=120   # index.lock older than this is worth flagging

# Subcommands that can mutate the index, the worktree, or local refs. `push`
# and `fetch` are deliberately absent: they touch no index, and leasing them
# would serialize work git already makes safe.
WRITE_VERBS='add|commit|rebase|merge|checkout|switch|reset|cherry-pick|revert|stash|am|apply|restore|rm|mv|pull|clean|gc|update-index|worktree|filter-branch'

payload=$(cat 2>/dev/null) || exit 0

# Broad textual scan. Two uses: the fallback when the command can't be pulled
# out of the JSON, and judging segments that don't *start* with git
# (`sudo git commit`, `bash -c "git commit ..."`). Deliberately loose -- when we
# cannot parse, taking a lease we don't need beats missing a write.
looks_like_write() {
  printf '%s' "$1" | grep -Eq "\bgit\b.{0,160}\b(${WRITE_VERBS})\b|\beas\b.{0,80}\b(build|update|submit)\b"
}

# Classify one shell segment.
#   0 = git/eas write   1 = git/eas read   2 = not a git/eas invocation
classify() {
  local seg="$1"
  local -a t=()
  read -r -a t <<< "$seg"
  local n=${#t[@]} i=0
  [ "$n" -gt 0 ] || return 2

  # Step over shell noise and leading env assignments (FOO=bar git commit).
  while [ "$i" -lt "$n" ]; do
    case "${t[$i]}" in
      '('|')'|'{'|'}'|'!'|then|else|do|time|command|builtin|exec) i=$((i+1)) ;;
      *=*) i=$((i+1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 2

  local prog="${t[$i]##*/}"
  prog="${prog%.exe}"

  if [ "$prog" = "eas" ]; then
    printf '%s' " ${t[*]:$((i+1))} " | grep -Eq ' (build|update|submit) ' && return 0
    return 1
  fi

  [ "$prog" = "git" ] || return 2

  # Skip git's global options; -C/-c and friends consume the next token too.
  i=$((i+1))
  while [ "$i" -lt "$n" ]; do
    case "${t[$i]}" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path) i=$((i+2)) ;;
      -*) i=$((i+1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || return 1   # bare `git`, `git --version`

  local sub="${t[$i]}"
  local rest=" ${t[*]:$((i+1))} "

  # First positional argument after the subcommand (`stash` -> `list`).
  local j=$((i+1)) arg=""
  while [ "$j" -lt "$n" ]; do
    case "${t[$j]}" in -*) j=$((j+1)) ;; *) arg="${t[$j]}"; break ;; esac
  done

  # Read-only forms of otherwise-writing subcommands. This is the whole point of
  # the rewrite -- these must not block a sibling session.
  case "$sub" in
    stash)
      case "$arg" in list|show) return 1 ;; esac ;;
    worktree)
      case "$arg" in list) return 1 ;; esac ;;
    apply)
      case "$rest" in *' --check '*|*' --stat '*|*' --summary '*|*' --numstat '*) return 1 ;; esac ;;
    clean)
      case "$rest" in *' -n '*|*' --dry-run '*) return 1 ;; esac ;;
    am|rebase)
      case "$rest" in *' --show-current-patch'*) return 1 ;; esac ;;
  esac

  case "$sub" in
    add|commit|rebase|merge|checkout|switch|reset|cherry-pick|revert|stash|am|apply|restore|rm|mv|pull|clean|gc|update-index|worktree|filter-branch) return 0 ;;
  esac
  return 1
}

want_lease=0

# Pull tool_input.command out of the payload. Only the command is judged, so a
# description that says "commit" no longer takes a lease.
cmd=$(printf '%s' "$payload" \
  | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
  | head -1 \
  | sed -e 's/^"command"[[:space:]]*:[[:space:]]*"//' -e 's/"$//' \
  | sed -e 's/\\n/;/g' -e 's/\\r/;/g' -e 's/\\t/ /g' -e 's/\\"/ /g')

if [ -z "$cmd" ]; then
  # Couldn't read the command -- fall back to the old whole-payload scan.
  looks_like_write "$payload" && want_lease=1
else
  # Split on shell separators and command substitution so each segment starts
  # with its own program name. Quoting is not honoured; a split inside a quoted
  # string only ever produces an extra segment, never a missed one.
  segments=$(printf '%s' "$cmd" | sed -e 's/&&/\
/g' -e 's/||/\
/g' -e 's/[;|&]/\
/g' -e 's/[`()]/\
/g')
  while IFS= read -r seg; do
    [ -n "${seg//[[:space:]]/}" ] || continue
    classify "$seg"
    case $? in
      0) want_lease=1; break ;;
      1) : ;;                                          # a git read -- no lease
      2) looks_like_write "$seg" && { want_lease=1; break; } ;;
    esac
  done <<< "$segments"
fi

[ "$want_lease" -eq 1 ] || exit 0

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
