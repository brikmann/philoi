# Recovery commands — land the concurrent-tree work safely

Four workstreams are in flight. **Sweep** is already committed + isolated on `fix/app-sweep` (worktree off
`07fcb40`) — leave it. **Flame**, **Cindy entry points**, and **campfire** are sitting uncommitted, intermingled
in the shared `add-marketing-site` tree and must be committed in order. File sets are disjoint (only `cindy.tsx`
is shared), so committing by explicit path cleanly separates them.

## Preconditions (read before any commit)
- 🔴 **Add by explicit path ONLY. Never `git add -A` / `git add .` / `git add <dir>`.** The sandbox shows 600+
  files "modified" — that's the CRLF artifact. A blanket add stages all of it. Every command below names files.
- **Lease:** `.git/claude-writer.lease` is currently **stale** (holder `e953dd02`, last write ~18:01). Per
  `AGENTS.md` do **not** clear it silently. Confirm no session is mid-write, then Noah clears it once, and the
  commits below run one at a time.
- **`index.lock`:** if `git` complains it exists and no git/EAS is running: `del .git\index.lock` (Windows).
- Run on **Windows** (real git), not the sandbox. Verify each file is a real change first: `git diff <file>`.

## Commit 1 — Flame (step 1), first (everything builds on it)
```sh
git switch add-marketing-site
# deleted generators (replaced by the unified one)
git rm scripts/gen-app-icon.js scripts/gen-notification-icon.js
# flame source (NOT cindy.tsx — it's shared, goes in commit 2)
git add src/components/ui/flame-logo.tsx src/components/flame-icon.tsx \
        src/components/personal-flame.tsx src/components/session-flame.tsx \
        src/components/ui/hexagon-badge.tsx \
        src/components/cindy/cindy-consent.tsx src/components/cindy/cindy-header-flame.tsx
# new raster pipeline
git add scripts/lib/flame-raster.js scripts/gen-flame-assets.js
# regenerated native + web assets
git add assets/images/icon.png assets/images/favicon.png \
        assets/images/android-icon-foreground.png assets/images/android-icon-monochrome.png \
        assets/images/splash-icon.png assets/images/notification-icon.png
# site
git add site/favicon.svg site/_assets/icon.html site/_assets/og.html \
        site/index.html site/privacy.html \
        site/favicon.png site/apple-touch-icon.png site/og.png
# only if `git diff app.config.ts` shows a real flame change:
# git add app.config.ts
git commit -m "Global flame: one mirrored orientation everywhere + unified raster generator"
```
Then release the lease.

## Commit 2 — Cindy entry points (needs commit 1's flame-icon.tsx)
```sh
# acquire lease, then:
git add src/app/cindy.tsx src/components/cindy/cindy-quick-sheet.tsx
git commit -m "Cindy entry points: tap-sheet + ?ask= prefill (on the new flame API)"
```
`cindy.tsx` carries both flame's prop-removal and the `?ask=` prefill — that's expected; it's the one shared
file, committed here. Release the lease. (The tap/hold/ring + header flame already shipped in `1aa950d`/`07fcb40`.)

## Commit 3 — Campfire, on its own branch for your gate (Option A)
```sh
# acquire lease, then branch off the new HEAD (which now has flame + Cindy):
git switch -c fix/campfire-pass
# add ONLY the campfire/challenge/watch files this pass changed (per CAMPFIRE_BUG_LEDGER.md) + the migration + ledger.
# add each by explicit path (git diff <file> first). e.g.:
git add supabase/migrations/0112_challenge_loop_repair.sql CAMPFIRE_BUG_LEDGER.md \
        src/app/challenge/create.tsx src/app/challenge-info/[challengeId].tsx \
        src/app/watch/[challengeId].tsx \
        src/components/challenges-tab.tsx src/components/challenge-card.tsx \
        src/lib/api/challenge-lifecycle.ts src/lib/api/challenges.ts src/lib/api/social-challenges.ts \
        src/hooks/use-challenge-watch.ts
        # ...plus any other file the ledger lists. Do NOT add fitness-challenge-sync.ts (see below).
git commit -m "Campfire loop repair (22 items) + 0112 — for review, off flame+cindy"
```
🔴 **Do NOT merge `fix/campfire-pass`** — Noah gates `CAMPFIRE_BUG_LEDGER.md` first, then the apply pass finalizes.

## Ownership correction — `fitness-challenge-sync.ts`
The daily-steps local-midnight fix belongs to the **sweep** (`fix/app-sweep`), which verified it — **not**
campfire. Campfire must **not** stage `src/lib/api/fitness-challenge-sync.ts`; it rides in on `fix/app-sweep` at
integration. Keep exactly one copy.

## Design docs + mocks (this Cowork session's edits)
`CINDY_SPEC.md`, `ORCHESTRATION.md`, `AGENT_PROMPT_*.md`, `RECOVERY*.md`, `design-mocks/115` + `117` are also
dirty (docs/mocks, no code dependency). Commit them separately whenever convenient:
`git add CINDY_SPEC.md ORCHESTRATION.md AGENT_PROMPT_*.md RECOVERY_COMMANDS.md design-mocks/115-cindy.html design-mocks/117-cindy-entry-points.html` → commit.

## Migration deploy order (after branches integrate) — ONE way
`0112` (campfire loop repair) → `0113` / `0114` (sweep: `grant_reward` fix + `0036` re-apply). 🔴 **Cross-branch
coupling:** `economy_on_social_challenge_closed` calls `grant_reward`, which has never paid out (sweep fix #1),
so **campfire settlement can't be validated until sweep's `0113/0114` deploy too.** Push both, then watch the
first cron tick. `supabase/verify_0113_0114.sql` reruns the SQL checks safely against prod.
```sh
npx supabase db push        # applies 0112, 0113, 0114 in order
```
No `functions deploy` needed (no edge function changed). Icons/splash/notification are native-only → new
`eas build` + delete/reinstall (Android caches launcher icons).
