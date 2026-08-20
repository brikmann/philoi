# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
This must match the `expo` version in `package.json` (currently `~57.0.8`) — bump this line when the SDK is upgraded.

# One writer at a time

Only ONE Claude session may run git write commands in this repo at a time.
Concurrent sessions have wedged `.git/index.lock` three times, and each time the
uncommitted work was one `git reset` away from being lost.

This is enforced mechanically by `.claude/hooks/git-writer-lease.sh` (a
`PreToolUse` hook on `Bash`). The first session to run a git write takes a lease
at `.git/claude-writer.lease`; a second session is blocked until that lease goes
stale (15 min with no git write). Reads — `status`, `log`, `diff`, `show` — are
never blocked.

If you are blocked:

- Do **not** delete the lease to get past it. Confirm with the user first.
- Do **not** clear `.git/index.lock` without first checking that no git or EAS
  process is running (`tasklist | grep -iE "git|eas"`).
- Wait for the other session, or ask the user which session should own the repo.

If you are the writer, commit early. A dirty tree is the thing at risk.
