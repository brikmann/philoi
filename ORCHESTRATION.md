# Agent orchestration — run order, branches, gates, ownership

The full roadmap in one place. Two lanes: **Lane A** = the stabilization merge train (flame + bugfixes,
diagnose→gate→apply). **Lane B** = feature / native-build / ops work that hangs off it. Core rules for both:
**branch per agent (never uncommitted), your review is a gate, run in dependency order.**

## Why not "all uncommitted, review at the end"
Uncommitted work in one tree isn't isolated — two agents editing the same file clobber each other, and you
can't review or revert a single change. Each agent commits to **its own branch** so every change is isolated,
diffable, and revertible. That's what makes interdependent work safe.

## The pattern (every task)
1. **Diagnose + propose** — agent works on its branch, writes a `*_LEDGER.md` with a `[ ] approve` box per
   item, **does not merge**.
2. **Your gate** — you skim the ledger + branch diff, tick `[x]` the right ones, strike the wrong ones, add
   notes where the fix should change.
3. **Apply** — the apply agent finalizes only approved items (redoing any where your notes override), reverts
   rejected ones, gets the branch green.
4. **Integrate** — merge the branch forward (you, or a reconcile pass) before the next dependent layer starts.

## ⚠ RECOVERY — the concurrent-tree collision (decided)
Three agents (flame, Cindy entry points, campfire) ran uncommitted into `add-marketing-site` at once, before
these rules landed. **Not a clobber** — file sets are disjoint (flame touched no challenge files; campfire
touched no flame/asset files; only `cindy.tsx` is shared), and `tsc` is clean over the combined tree. The 600+
"modified" files in the sandbox are the CRLF artifact, not real edits. **Do not re-run anything.** Serialize the
commits by the git lease, in dependency order:

1. **Flame session** (holds the lease `e342ea95`) commits first — its ~30 files **except `cindy.tsx`**. Lands
   step 1; supersedes Cindy's `253f985` cleanly. Release lease.
2. **Cindy session** commits `cindy.tsx` (the shared file — carries flame's prop-removal **and** its `?ask=`
   prefill) + `cindy-quick-sheet.tsx`. Release lease.
3. **Campfire session** takes the lease, cuts **`fix/campfire-pass`** off the new HEAD, commits its 22 fixes +
   `0112` **there (not on `add-marketing-site`)** → Noah gates via `CAMPFIRE_BUG_LEDGER.md` before merge.
   (This is the ledger's **Option A**, chosen.)
- `fitness-challenge-sync.ts`: **keep** (correct local-midnight fix per 0084) but it belongs to the **sweep**
  (`fix/app-sweep`), which verified it — **not** campfire. Campfire must not stage it; one copy only.
- Then the normal apply pass finalizes the approved campfire items; integrate campfire → ship branch.
- 🔴 **Cross-branch migration coupling:** sweep found `grant_reward` has never paid out (enum-vs-`CASE` →
  `text`), fixed in `0113`/`0114`. `economy_on_social_challenge_closed` calls `grant_reward`, so **campfire
  settlement can't be validated until `0113`/`0114` deploy too.** Deploy order `0112 → 0113 → 0114`; watch the
  first cron tick. Migrations don't collide (each branch took the next free number off `07fcb40`) — verify.

## LANE A — stabilization merge train (dependencies are real — don't parallelize these)

### 1. Global flame icon — FOUNDATIONAL, land first
- Prompt: `AGENT_PROMPT_global_flame_icon.md` → branch `feat/global-flame`.
- Establishes the single canonical (flipped) flame glyph everything else renders. Owns the flame **visual** —
  glyph orientation in `flame-logo.tsx` + all flame components, plus icon/splash/notification/favicon assets +
  `site/` favicons. (Flame *interaction* — the tap ring-pulse press state — is Lane B1, sequenced after.)
- **Gate → merge before step 2 AND Lane B1** (both consume the new flame).

### 2. Campfire pass — after flame lands
- Diagnose: `AGENT_PROMPT_bugfix_campfire.md` → branch `fix/campfire-pass`, writes `CAMPFIRE_BUG_LEDGER.md`.
- **Your gate.**
- Apply: `AGENT_PROMPT_apply_campfire_fixes.md` → finalizes approved, reverts rejected.
- Owns: `src/app/campfires.tsx`, `(tabs)/challenges.tsx`, `challenge*/**`, `watch/**`, `campfire-*`,
  `challenge*` components, challenge hooks/api. Branches off `feat/global-flame` so bug #1 sees the new flame.

### 3. App-wide sweep — last, campfire EXCLUDED
- Diagnose: `AGENT_PROMPT_bugfix_sweep.md` → branch `fix/app-sweep`, writes `APP_BUG_LEDGER.md`.
- **Your gate.**
- Apply: `AGENT_PROMPT_apply_sweep_fixes.md`.
- Owns: everything **except** the campfire/challenge/watch surface (that's step 2's). Any campfire bug it finds
  → logged for the campfire agent, not fixed.

### 4. Final integration
- Merge `fix/campfire-pass` then `fix/app-sweep` onto the ship branch; resolve any last shared-file conflicts
  (same job as `RESOLVE_B_MERGE.md`). Run `npx tsc --noEmit` + boot once more. Then the deploy-gated steps each
  ledger collected (db push / functions deploy / native rebuild).

## File-ownership map (so branches don't overlap)
| Surface | Owner |
|---|---|
| flame **visual** (glyph orientation) + all icon/splash/favicon assets + `site/` | **1 · global-flame** |
| flame **interaction** (tap ring-pulse press state) + Cindy entry points (header flame, hold-to-talk, lock-in placement) | **B1 · cindy-entry-points** |
| campfire / challenge / watch (screens, components, hooks, api) | **2 · campfire** |
| everything else (home, lock-in, done, daily-fire, profile, shop/inventory/box, settings, onboarding, Cindy chat) | **3 · sweep** |
| Screen Time / Family Controls extensions | **B2 · focus-nudge** (own native build) |

If a task needs a file another owns → **flag it in its ledger, don't edit it.** Flame components are shared by
1 and B1 — 1 does the visual and lands first, B1 rebases and adds only press/gesture code.

## Parallel-safe?
Steps 2 and 3 have disjoint ownership, so their **diagnose** passes *can* run in parallel — but both branch off
`feat/global-flame`, so **step 1 must land first** regardless. Keep the apply passes sequential (2 then 3) so
integration is one-way.

---

## LANE B — features / native build / ops (hang off Lane A, sequenced)

### B1. Cindy entry points — build, after step 1 lands
- Prompt: `CODE_PROMPT_cindy_entry_points.md` → branch `feat/cindy-entry-points`, rebased on `feat/global-flame`.
- **Build → your review → merge** (it's a feature build with acceptance criteria, not a diagnose/apply hunt).
- Depends on step 1 because the **tap ring-pulse** modifies the shared flame **press state**
  (`cindy-flame-press.tsx` / `PersonalFlame` / `SessionFlame`) — step 1 owns the flame *visual*, B1 owns the
  flame *interaction*. Run B1 after `feat/global-flame` merges so they don't fight over the flame components.
- Also adds: header flame on non-home screens, hold-to-talk, lock-in Cindy placement (Option A). These touch
  home / lock-in / done — coordinate with the sweep (step 3): whichever runs second rebases, doesn't re-edit.

### B2. Focus Nudge — its own NATIVE build track
- Screen Time extensions + Family Controls entitlements → a separate `eas build`, deliberately **not** bundled
  with the JS merge train or the Cindy build (`SHIP_CINDY_BUILD.md` keeps it out). Point it at the shared
  `_shared/coach/` — don't build a second coach brain. Runs after Lane A stabilizes.

### B3. GCal OAuth verification — OPS, not code (no branch, no ledger)
- Gated on a **working native build existing** (needs the demo video). Steps: record the connect-flow + Cindy
  using a real deadline → upload Unlisted to YouTube → Google Verification Center → submit → then flip
  `GOOGLE_CALENDAR_ENABLED = true` (one line, no rebuild). Details in `SHIP_CINDY_BUILD.md` / `DEPLOY_CINDY_RUNBOOK.md`.

## Cross-cutting: shared keyboard-avoiding wrapper
App-wide bug (keyboard doesn't push the UI up) is fixed once with a shared wrapper
`src/components/ui/keyboard-avoiding.tsx`, then adopted on every input surface. It's an **isolated new file**, so
collision risk is near zero — but two agents need it (campfire chat + all sweep inputs) and campfire runs first.
Rule: **whichever of campfire/sweep runs first creates the file; the other imports it.** The sweep prompt owns
the canonical spec of the wrapper; if campfire lands first, it stubs adoption and the sweep reconciles to the
one file at integration. Don't ship two implementations.

## Build/deploy gating — batch the native builds
Icons/splash (step 1), Focus Nudge (B2), Cindy voice, and the GCal demo (B3) all need a **native `eas build`**
(not OTA). Land Lane A + B1 on the ship branch first, then cut **one** native build that carries the flame
assets + Cindy entry points, use it to record the B3 demo, and keep Focus Nudge's extensions as a separate
build after. Don't cut a build mid-merge-train.
