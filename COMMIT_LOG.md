# Commit log — concurrent-tree recovery (landed)

The three uncommitted workstreams were serialized and committed cleanly; the sweep was already isolated.
Staging was by explicit path only (no CRLF spill): 26 / 2 / 14 / 11 files across the four commits.

## `add-marketing-site` (ship branch)
```
329c374  Orchestration docs, agent prompts, and Cindy mocks
c84e7fe  Cindy entry points: tap-sheet + ?ask= prefill
d69a10b  Global flame: one mirrored orientation + unified raster generator
07fcb40  (previous HEAD)
```

## Parked branches — NOT merged, awaiting Noah's gate
```
fix/campfire-pass   53dc9c5  Campfire loop repair (22 items) + 0112     (off c84e7fe — carries flame + Cindy, ancestry-verified)

fix/app-sweep — TIP is 29b02d5 (off 07fcb40). FIVE commits; merge the TIP, not the base:
  29b02d5  Bug ledger (APP_BUG_LEDGER.md)              ← tip — MERGE THIS
  b7f6d58  0115: re-apply 0036 (never ran)
  5091c75  0113: time-counted goals credit hours
  b6b9b21  0114: grant_reward enum casts
  30d1ab4  Daily goals: LOCAL midnight (fitness-sync)  ← base — do NOT merge alone
```
🔴 **Merge the tip `29b02d5`, not `30d1ab4`.** `30d1ab4` is the base — merging it gets only the fitness-sync
fix and silently drops `0113`/`0114`/`0115` + `APP_BUG_LEDGER.md`. That's exactly the `grant_reward` fix the
settlement gate needs, so the merge would look clean and the gate would stay closed.

## Notes
- `fitness-challenge-sync.ts` is left dirty in the working tree — byte-identical to `30d1ab4` on
  `fix/app-sweep`, so it's a harmless no-op the sweep merge overwrites. Do **not** `git checkout --` it.
- Nothing pushed. Nothing deployed.

## UPDATE (live) — sweep merged, campfire NOT, 0112 gap
- `add-marketing-site` tip = `aa48dca` **Merge fix/app-sweep** (correct — carried tip `29b02d5`,
  `0113/0114/0115`; fitness-sync deduped to one copy). `grant_reward` verified working.
- 🔴 **`0112` is missing in prod** — `schema_migrations` jumps `0111 → 0113`. `fix/campfire-pass` was never
  merged, so the challenge-loop repair (`0112`) isn't deployed. `grant_reward` (0114) without `0112` is half a
  fix — settlement will try to pay and still be broken. **URGENT: merge `fix/campfire-pass` → push `0112`.**
- `db push` will apply `0112` after `0113–0115` — fine (0112's settlement calls `grant_reward`, which now exists).
- Then build `#3`/`0116` (reward screen) as a fast-follow; not on the loop's critical path.

## Next (when ready — no rush)
1. Review the two ledgers: `CAMPFIRE_BUG_LEDGER.md`, `APP_BUG_LEDGER.md` (tick `[x]` approvals).
2. Run the two apply passes (`AGENT_PROMPT_apply_campfire_fixes.md`, `AGENT_PROMPT_apply_sweep_fixes.md`).
3. Integrate: merge campfire, then sweep, onto `add-marketing-site`; reconcile the fitness-sync duplicate.
4. Deploy migrations **in order**: `0112 → 0113 → 0114 → 0115` (`npx supabase db push` applies in filename
   order, so it's self-enforcing **once all four are on the branch** — the only risk is `0115` being left
   behind, same failure mode as merging the wrong app-sweep commit). Then watch the first cron tick
   (`supabase/verify_0113_0114.sql`). Sweep migrations: `0113_lockin_time_goal_credit_repair`,
   `0114_grant_reward_ember_reason_cast`, `0115_reapply_0036_whoop_integration`.
5. Cut **one** native `eas build` for the flame assets (icons/splash/notification are native-only; Android
   caches launcher icons → delete + reinstall).

## Migration collisions — none (confirmed)
`0112`, `0113`, `0114`, `0115` each appear exactly once across both branches. The repeated
`0100/0101/0105/0110/0111` are shared history counted on both branches, not duplicates. (Worth re-confirming at
integration — silent `schema_migrations` drift is what broke `0036` in the first place.)

## Gate to remember
🔴 Campfire settlement can't be validated until sweep's `grant_reward` fix (`0113/0114`) is live —
`economy_on_social_challenge_closed` calls `grant_reward`, which has never paid out. Test tie/winner behaviour
only after those migrations deploy, not on the campfire branch alone.

## Campfire ledger — APPROVED (all 22)
All items approved. 1–2 + 4–20 already applied on `fix/campfire-pass`; #10 no-op; #21/#22 left as-is. **#3 is
the one net-new build** (reward screen + share card, per `DECISION_reward_screen_and_goal_drip.md`) — the
campfire apply pass builds it, then the branch integrates. Sweep ledger still awaiting its ticks.

## Decisions — resolved
- **Custom-goal drip = `easy` (12/day)** ✅ decided. Fixes the `{0,0}`→top-drip bug. Recorded in
  `CHALLENGE_REWARD_ALGO.md` + `DECISION_reward_screen_and_goal_drip.md` (#7). Sweep apply pass implements.
- **Ledger #3 (reward screen + share card)** ✅ wired: fire-once on first settled view, new
  `get_challenge_reward` RPC + `reward_seen_at` flag, share reachable from standings — spec in
  `DECISION_reward_screen_and_goal_drip.md`. Campfire apply pass implements.
- **Ledger #6 (name a time-counted goal via chips)** — recommended approving; it's the trigger for #7.

## Still parked
- `audio-base-hearth-hum.mp3` + preview: generated + placed in `assets/audio/cosmetic/`; needs committing.
