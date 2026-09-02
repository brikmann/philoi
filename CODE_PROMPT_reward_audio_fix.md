# Code Prompt — Reward reveal: fanfare cut-off + ember-claim sound

Two audio bugs on the goal/challenge reward reveal (the rays + brand-purple background already work; brand purple was just fixed by wrapping the goal reveal in `ScreenBackground`). Client/OTA on `integration-wave1`.

## §1 · The victory fanfare cuts off halfway — it must ring out fully
On the goal-complete reveal, `useRevealCue('daily_fire')` (`reward-reveal.tsx` ~line 202) plays `REVEAL_TUNING.daily_fire.cue` = **`victory-short`** once on mount, fire-and-forget (no cleanup). Players are **per-cue** (`sound.ts` — `players[cue] = createAudioPlayer(...)`), so nothing at the player level should interrupt it — yet Noah hears it **cut off ~halfway; it needs to stretch fully.**

Diagnose + fix, in order:
1. **Is it the asset or a stop?** `victory-fanfare-short.mp3` is a ~2.5s trim — check it doesn't simply **end abruptly mid-phrase** (which reads as "cut off"). If so, either **point `daily_fire` at the full `victory` cue** (`victory-fanfare.mp3`, ~3.84s, resolves properly) or re-trim the short so it ends on a resolved note. Given Noah's "needs to stretch fully," **defaulting `daily_fire` → `victory` (full) is the likely fix** — flag short-vs-full for him.
2. **Is something stopping it?** Confirm nothing calls `stopRewardSound`/`stopRewardSounds`/`fadeOutRewardSound` on the victory cue when the reveal dismisses or when a claim runs, and that the **audio session isn't reconfigured** mid-playback (the mix-mode logic in `sound.ts` ~170-222). The fanfare should **ring out like the rank-up hits do** ("do NOT clip the tier hits") — leaving/claiming the reveal must not truncate it.
3. Verify on device: complete a goal, let the reveal sit AND claim quickly — the fanfare plays to its natural end both ways.

## §2 · The ember claim plays the OLD sound (and doesn't feel right)
The ember-claim step fires **`fireEmberLand()`** per landing ember (`reward-claim.tsx` ~line 439), which plays **`playRewardSound('spark', 0.4)`** (`reward-feedback.ts` ~241) — the old per-ember sparkle tick. Noah: *"still fires the old sound effect… doesn't exactly work right."*
- **Swap the sound.** The ember claim (embers flying into the balance) should play the **scoped ember sound once as they set off**, not a repeated old `spark` tick. Use a single soft **`whoosh`** (or the sell-flow's `ember-smoke` identity if we want claim + sell to match) at the start of the ember flight, and **drop or keep-only-haptic** the per-ember `spark` ticks. Do NOT let the claim sound step on the §1 fanfare (different cue/player — fine — but don't stack a busy tick-storm under the fanfare).
- **Confirm the claim actually works:** the embers visibly fly to the top-right balance, the balance ticks up by the amount, and the reveal advances/dismisses cleanly. Report anything off in the flight/measurement (`useRewardClaim` measures refs — a null/unmeasured ref makes the flight land wrong).
- Reduce-motion: skip the flight, just count the balance up + refresh.

## Done
- The reward fanfare plays to its full natural end on every goal/challenge reveal (claimed or not), no mid-clip cut — default daily to the full `victory` unless Noah wants short.
- The ember claim plays the intended ember sound (single whoosh/ember, not the old `spark` tick), the flight lands in the balance and ticks it, reduce-motion falls back to a count-up.
- (Done already: reveal background = brand purple `ScreenBackground`; full-screen rays; raster-clamp crash fix.)
