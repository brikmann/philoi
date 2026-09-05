#!/usr/bin/env bash
# Tests for git-writer-lease.sh.
#
# The hook's failure mode is asymmetric and both directions are expensive:
# missing a write lets two sessions wedge .git/index.lock, and taking a lease on
# a *read* blocks a sibling session for up to fifteen minutes. `git stash list`
# did exactly that. Run this after any change to the hook:
#
#   bash .claude/hooks/git-writer-lease.test.sh
#
# Every case runs the hook against a synthetic payload inside one throwaway
# repo, so nothing here can touch the real .git/claude-writer.lease.

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/git-writer-lease.sh"
[ -f "$HOOK" ] || { echo "hook not found: $HOOK" >&2; exit 1; }

REPO=$(mktemp -d)
trap 'cd /; rm -rf "$REPO"' EXIT
git init -q "$REPO" >/dev/null 2>&1 || { echo "could not init test repo" >&2; exit 1; }
cd "$REPO" || exit 1
LEASE="$REPO/.git/claude-writer.lease"

pass=0; fail=0

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

# run_hook <session_id> <command> [description] -> exit code on stdout
run_hook() {
  printf '{"session_id":"%s","tool_name":"Bash","tool_input":{"command":"%s","description":"%s"}}' \
    "$1" "$(json_escape "$2")" "$(json_escape "${3:-}")" \
    | bash "$HOOK" >/dev/null 2>&1
  printf '%s' "$?"
}

# expect <read|write> <command> [description]
expect() {
  local want="$1" cmd="$2" desc="${3:-}" got rc
  rm -f "$LEASE"
  rc=$(run_hook "SESSION-A" "$cmd" "$desc")
  if [ -f "$LEASE" ]; then got=write; else got=read; fi
  if [ "$got" = "$want" ] && [ "$rc" = "0" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    printf 'FAIL  expected %-5s got %-5s (exit %s)  %s\n' "$want" "$got" "$rc" "$cmd"
  fi
}

echo "-- reads must NOT take the lease --"
expect read  'git stash list'
expect read  'git stash list --stat'
expect read  'git stash show -p stash@{0}'
expect read  'git status --porcelain'
expect read  'git log --oneline -5'
expect read  'git merge-base --is-ancestor abc HEAD'
expect read  'git show stash@{0}'
expect read  'git diff --cached --stat'
expect read  'git worktree list'
expect read  'git branch --merged'
expect read  'git rev-parse --abbrev-ref @{u}'
expect read  'git ls-files supabase/migrations/'
expect read  'git apply --check /tmp/p.diff'
expect read  'git clean -n'
expect read  'git -C /some/repo stash list'
expect read  'git status' 'Commit the audio file and reset the index'
expect read  'grep -rn "git" src/'
expect read  'npx supabase db push --linked'
expect read  'git stash list; git log -1; git diff'

echo "-- writes MUST take the lease --"
expect write 'git commit -m "x"'
expect write 'git add -A'
expect write 'git add assets/sounds/challenge-start.mp3'
expect write 'git stash'
expect write 'git stash push -m wip'
expect write 'git stash pop'
expect write 'git -C /some/repo commit -m y'
expect write 'FOO=1 git reset --hard HEAD'
expect write 'sudo git commit -m z'
expect write 'bash -c "git commit -m q"'
expect write 'git stash list && git commit -m x'
expect write 'git log -1
git commit -m second-line'
expect write 'git worktree add ../wt-a'
expect write 'git clean -fd'
expect write 'git apply /tmp/p.diff'
expect write 'git checkout -- src/'
expect write 'git rm --cached foo'
expect write 'eas build --platform android --profile preview'

echo "-- contention still blocks --"
rm -f "$LEASE"
a=$(run_hook "SESSION-A" 'git commit -m first')
b=$(run_hook "SESSION-B" 'git commit -m second')
c=$(run_hook "SESSION-B" 'git stash list')
if [ "$a" = "0" ] && [ "$b" = "2" ]; then
  pass=$((pass+1))
else
  fail=$((fail+1))
  echo "FAIL  lease holder exited $a (want 0), second writer exited $b (want 2)"
fi
if [ "$c" = "0" ]; then
  pass=$((pass+1))
else
  fail=$((fail+1))
  echo "FAIL  a read by the blocked session exited $c (want 0) -- reads must never be blocked"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
