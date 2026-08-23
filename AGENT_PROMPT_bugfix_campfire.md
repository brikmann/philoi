# Agent task — bugfix everything from the recent campfire pass

**Goal:** the campfire + challenge-v2 redesign shipped across parallel agents (A/B worktrees) and a manual merge.
Noah's device screenshots showed leftover UI errors and old schematics. Hunt down and fix everything that's
broken or half-wired from that pass. **Stabilize, don't add scope.**

## Context / source of truth
- Specs: `CAMPFIRE_REDESIGN_SPEC.md`, `CHALLENGE_V2_SPEC.md`, `CHALLENGE_UI_SPEC.md`, `CHALLENGE_REDESIGN_SPEC.md`,
  `CHALLENGE_REWARD_ALGO.md` / `_COPY.md`.
- Handoffs: `CODE_HANDOFF_campfire.md` (+ `_A.md` / `_B.md`), `CODE_HANDOFF_challenges.md`, `RESOLVE_B_MERGE.md`
  (the merge resolution — verify it actually landed the way it's written).
- Mocks: `design-mocks/110-campfire-redesign.html`, `111-watch-report.html`, `112-campfire-full-map.html`,
  `113-challenge-system-v2.html`, `114-placement-challenge.html`. **Match these** — flag any screen still on an
  old schematic.
- Migrations from the pass: `0094`, `0096`–`0100`, `0110` (cheer notes), `0111` (participant-aware settlement).

## 🔴 Observed on device (Noah's screenshots, Aug — fix these first, they're confirmed)
1. **Campfire flame renders as the small ember/coal "donut," not a flame.** In the valley card ("Goat ·
   steady"), the interior banner ("EMBERS · 2 OF 3 TODAY"), and the create-campfire name field, the campfire
   glyph is tiny and shaped like the ember token, not the flame mark. Should be the flame (flipped — see
   `AGENT_PROMPT_global_flame_icon.md`) at a proper size. Check `campfire-flame.tsx` /
   `campfire-flame-stage.tsx` / `campfire-banner-art.tsx` — likely rendering `EmberIcon`/wrong glyph or a bad
   size.
2. **Campfire interior header double-renders the title.** "Goat" appears twice (one ghosted/faded behind the
   other) and the small flame logo overlaps the back chevron / title. Fix `campfire-header.tsx` (duplicate
   `<Text>` / stacked header, z-index/overlap).
3. **Head-to-head VS scoreboard card is clipped at the top** — the player avatars are cut off by the card's top
   edge (challenges list). Needs top padding / `overflow: visible` on `challenge-card.tsx` (or the avatars sit
   outside the card bounds).
4. **Metric mismatch.** The pending head-to-head reads "Most lock-in time," but the active/finished VS card
   shows "Most XP." Confirm the displayed metric matches the challenge's actual metric end-to-end (create →
   card → watch).
5. **Tie / settlement.** Equal XP shows "It's a tie · Rematch." Verify a tie is a real settled state and that
   tie/winner XP awards fire correctly and **exactly once** (ties across the pass are suspicious given 0111).
6. **Watch screen shows the same person on both sides.** Both competitors render "Noah Brikman" — the opponent
   identity isn't resolving (self, or a bad profile join). Also the **cheer counts are identical (7 / 7)** —
   confirm they're per-person, not mirrored. `watch/[challengeId].tsx` + `use-challenge-watch.ts` (0099/0110).
7. **Watch status contradiction.** Header says "ending soon" while the footer says "Final · this challenge has
   ended." One source of truth for challenge status.
8. **Keyboard doesn't push the UI up** in the campfire **"Message the campfire"** feed/chat input — the input
   hides behind the keyboard. 🔴 Use the **shared keyboard-aware wrapper** the app-sweep agent builds
   (`src/components/ui/keyboard-avoiding.tsx`) — do **not** roll your own. If the sweep branch hasn't landed the
   wrapper yet, flag it and stub the adoption so it drops in cleanly.

## Surfaces to audit (built during the pass)
Screens: `src/app/campfires.tsx`, `src/app/(tabs)/challenges.tsx`, `src/app/challenge/create.tsx`,
`src/app/challenge-info/[challengeId].tsx`, `src/app/challenge-change/[requestId].tsx`,
`src/app/watch/[challengeId].tsx`.
Components: `campfire-header.tsx`, `campfire-flame-stage.tsx`, `campfire-flame.tsx`, `campfire-banner-art.tsx`,
`campfire-options-sheet.tsx`, `campfire-preview-sheet.tsx`, `challenges-tab.tsx`, `challenge-card.tsx`,
`social-challenge-card.tsx`, `challenge-manage-sheet.tsx`, `challenge-sent-sheet.tsx`,
`challenge-completion-card.tsx`, `economy/challenge-reward-screen.tsx`, `economy/challenge-win-share-card.tsx`,
`active-challenge-marker-chip.tsx`, `empty-states/burnt-out-campfire.tsx`.
Hooks/api: `use-challenge-feed.ts`, `use-challenge-watch.ts`, `use-my-challenges.ts`, `use-social-challenges.ts`,
`use-campfire-heat.ts` / `-role.ts` / `-stats.ts`, `lib/api/challenge-lifecycle.ts`, `challenges.ts`,
`social-challenges.ts`, `fitness-challenge-sync.ts`.

## Focus areas (known-fragile from the pass)
1. **Merge fallout (`RESOLVE_B_MERGE.md`):** confirm `challenges-tab.tsx` is B's placeholder-replaced version,
   `database.ts` is the additive union (no dropped columns/types), and `create.tsx` / `social-challenges.ts` are
   B's. Look for duplicate/lost symbols, stale imports, half-merged JSX.
2. **Old schematics still rendering** — any campfire/challenge screen that doesn't match mocks 110–114 (Noah saw
   these on device). Fix to the mock.
3. **Settlement correctness (0111):** group challenges must settle against the **invited subset**, not the whole
   campfire; baseline honored; XP awards land once. This was hand-audited, not runtime-verified — watch the
   first cron tick / write a targeted test.
4. **Watch screen (`watch/[challengeId].tsx`, 0099):** the "column reference status is ambiguous" class of SQL
   bug; per-person meters + cheer feed under each person; cheer → push (0110 cheer notes); report screen clean;
   report emails Noah. Verify the heart/cheer accuracy Noah flagged.
5. **Challenge lifecycle:** create → invite/accept → active → settle → reward screen → share card. Walk the full
   loop; fix dead ends, wrong states, missing reward/results screen, broken share card.
6. **Push notifications** for challenge events fire correctly (and are idempotent).

## Rules
- New migration for any SQL fix (forward-only); **don't** edit `0094`–`0111`. Don't run `db push` /
  `functions deploy` — list them as deploy-gated for Noah.
- Don't weaken RLS/`auth.uid()` scoping. Reward math stays authoritative server-side; honor the economy
  firewalls.
- Match mocks 110–114 for anything visual.

## Deliver (this is a DIAGNOSE + PROPOSE pass — Noah reviews before anything ships)
- Do the work on a dedicated branch (e.g. `fix/campfire-pass`) — **do not merge to the ship branch.**
- Write the **bug ledger to `CAMPFIRE_BUG_LEDGER.md`**, one numbered entry per bug:
  `[ ] approve` · surface · repro · root cause · the fix you made (files + diff summary) · how you verified.
  Leave the `[ ]` for Noah to check. Include any bug you found beyond the 7 above.
- Before/after screenshots for every visual fix (prove it matches mocks 110–114).
- New migrations forward-only; a separate **deploy-gated** list (db push / functions deploy / cron to watch).
- `npx tsc --noEmit` clean on the branch.
- Noah will review the ledger + diffs, tick the ones that are right, and hand it to
  `AGENT_PROMPT_apply_campfire_fixes.md` to finalize.
