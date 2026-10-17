# BUILD 10 runbook — merge the 4 agent branches → typecheck → TestFlight

Goal: one production build to TestFlight for solo testing (cosmetic gallery + all P0 device-test fixes). Run in a CLEAN
checkout with a working `npm`/`tsc` (the agents committed but could NOT run typecheck in their environment).

## The FIVE branches to merge (all off `integration-wave1`)
- `agent1-cosmetics` (678ffc0) — Cosmetic Preview Gallery + `cosmetic-render.tsx` dispatcher.
- `agent2/onboarding-cindy-emberfall` (4a0fd78) — campfire-loop fix, Cindy tutorial + Emberfall unblocked, junk-folder copy, safe-area fallback.
- `agent3-auth-screens` (8d26928) — Google nonce, white Friends/Valley fix + error boundary.
- `agent4/challenges-shop` — Cindy creation 2→1, back arrow, legacy shop tile removed, priceString.
- `economy-anticheat` (aca25c3) — kill vouching, grade cap Epic + 2/season, physical cap Rare, lock-in liveness 10min. **Ships migration `0221_the_economy_stops_trusting_a_claim.sql`** + client vouch-UI removal. (Ignore the superseded `economy-ac2`/c79de8e.)

⚠️ **Overlap risk:** `economy-anticheat` and `agent4/challenges-shop` both touch challenge/reward/shop client files, and 0221 restates functions from 0167/0210/0218. Merge carefully and let typecheck catch conflicts. Placement cap (migration 0066) was intentionally left alone — Noah's open decision.

## Steps
1. **Fresh checkout** of `integration-wave1` (or a new `build10` branch off it). Confirm the tip includes the
   expo-image fix commit (`0e620e6`, "align every Expo package to SDK 57") — without it the build crashes on launch.
2. **Merge the four branches** into `build10`. Lanes were file-disjoint, so conflicts should be minimal; the one shared
   file is `_layout.tsx` (Agent 2 only — no conflict expected). Resolve any conflict favouring the lane that owns the file
   (per `CODE_ORCHESTRATION_build10.md`).
3. **Run the gates and fix anything red** (this is the step the agents couldn't do):
   ```
   npm ci                      # clean install so node_modules matches the lockfile
   npm run typecheck           # tsc + check:cosmetic-rarity + the other check:* scripts
   npm run lint
   npx expo-doctor             # confirm expo-image 57.0.1 / expo-modules-core 57.0.7 still aligned
   ```
   Do NOT build until typecheck is green. The gallery's imports were verified to resolve, but the agents' other edits
   are untested — expect a few small fixes.
4. **Cut the build:**
   ```
   eas build --platform ios --profile production --clear-cache
   ```
5. **Submit to TestFlight:**
   ```
   eas submit --platform ios --profile production --latest
   ```
   This is build 11 (build 9 was the last uploaded number; EAS auto-increments). TestFlight only — do NOT submit for
   App Review yet.

## Apply the economy migration to prod (Noah — separate from the build)
The client vouch-removal ships in the binary; the reward-logic changes are in migration **0221**, applied to prod DB.
1. First verify the ledger is current: `npx supabase migration list --linked` — prod must already be at **0218, 0219,
   0220** (0221's top-of-file base-checks fail loudly if not). You applied 0219/0220 earlier; confirm 0218 too.
2. Apply + record per MIGRATIONS.md (apply the single file via `db query --linked -f`, then
   `migration repair --status applied 0221 --linked`). Never bare `db push`; never hand-edit `schema_migrations`.
3. The migration self-tests (23 anti-cheese asserts) run at apply time — if any raise, it won't commit, which is the
   safety you want. Read the error and stop rather than forcing it.

## Before you test on device
- **Set `is_dev = true` on your test account in prod** (Supabase → profiles) — otherwise the Cosmetic Preview Gallery
  and Dev tools menu won't appear in a production build (`__DEV__` is false there). This is how you reach the gallery to
  review cosmetics on real render output.

## What to validate on this build
- Cosmetic gallery renders (Settings → Dev tools → Cosmetic Preview Gallery) — every type paints on Art/Profile/Lock-in/Chat.
- Fresh account → home, NO campfire-create loop; Cindy tutorial + Emberfall intro fire.
- Google sign-in works; Friends + Campfire Valley render (no white screens).
- No safe-area top crop; challenge creation is fewer taps + has a back arrow; one Flame Pass tile in the shop.

## NOT in this build (fast-follow)
- Economy grade-cap + kill-vouching (`CODE_PROMPT_economy_grade_cap.md`, if written) — a server migration + client vouch
  removal; can be build 11 or folded in if ready before the build.
- The full cosmetic craft pass (real fire/lava/glitch) — iterate against the gallery, then fold into a later build.

## Constraints
- Stage/commit locally only; the `git push` and the EAS submit and any prod DB apply are Noah's actions (push is
  classifier-blocked for the assistant). Never `git add -A` (Firebase key in root). Never touch the `.p8`.
