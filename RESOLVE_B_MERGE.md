# Resolve: merge worktree-challenge-subsystem-b → add-marketing-site

Verified: the merge is **clean and low-risk**. Only 2 files truly conflict; the fix is mechanical. Run this on
the **Windows checkout** (not a Linux sandbox — CRLF would pollute the whole tree).

## The conflicts (verified)
| File | Reality | Resolution |
|---|---|---|
| `src/components/challenges-tab.tsx` | add/add — **A's is an intentional placeholder**, B's is the real impl and **keeps A's exact prop contract** (groupId, myUserId, isAdmin, ListHeaderComponent, bottomGap) | **take B's** (`--theirs`) |
| `src/types/database.ts` | changed in both — **purely additive**: A = `MemberRole`/`CampfireMember` + 4 role RPCs; B = challenge status/shape/metric/participant + 4 challenge RPCs. Distinct symbols; only the `Functions {}` block has both inserting. | **union — keep BOTH sets** (no semantic collision) |
| `src/app/challenge/create.tsx` | **A never changed it** (0 vs base) — not a real conflict | git auto-takes B's; if flagged, `--theirs` |
| `src/lib/api/social-challenges.ts` | **A never changed it** (0 vs base) — not a real conflict | git auto-takes B's; if flagged, `--theirs` |

Migrations `0096`–`0098` are B-only (no conflict) and slot cleanly before the `0100`/`0105` already in main.
A's `0094`/`0095` are already in main, so `0096`'s prerequisite is satisfied.

## Commands
```sh
git checkout add-marketing-site
git merge --no-ff worktree-challenge-subsystem-b

# take B's for the take-theirs files (only the ones git marks conflicted):
git checkout --theirs src/components/challenges-tab.tsx
# (and create.tsx / social-challenges.ts only if git actually marks them)

# database.ts: open it, keep BOTH A's role types/RPCs AND B's challenge types/RPCs.
#   - All added type names are distinct — no renames, no clashes.
#   - The one physical conflict is inside `Functions: { ... }` where both inserted entries: keep both blocks.
#   - Keep B's rewritten SocialChallengeStatus (adds 'draft') and SocialChallengeRaceMetric (adds volume/
#     distance/ai) — A didn't touch those.

git add src/components/challenges-tab.tsx src/types/database.ts src/app/challenge/create.tsx src/lib/api/social-challenges.ts
git commit    # keep the merge commit
```

## Then
```sh
npx supabase db push      # → Yes. Applies 0096→0098 + 0100 in order (0094 present, no guard trip)
npx expo start -c         # one clean --clear restart for the Metro loop
```

## Sanity checks after
- `npx tsc --noEmit` clean (the database.ts union is the only place to typo).
- `git status` shouldn't show a mountain of unrelated `.md` files — if it does, your `core.autocrlf` is off;
  fix that before committing so you don't ship line-ending noise.
