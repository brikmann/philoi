# Code Prompt — Reward reveal: full-screen rays + box-first-then-embers + per-reward claim animations

Builds on `CODE_PROMPT_daily_reveal_rays.md` (which added `RewardRays` to the goal-complete reveal — that landed, the flame now has a ray fan). Noah's on-device notes on the reveal, three parts. Client/OTA on `integration-wave1`, no rebuild, no economy change (reveal is a pure read over what the server already granted).

**Applies to the reward reveals:** `GoalStreakRewardScreen` (`src/components/economy/goal-streak-reward-screen.tsx`, the "DAILY GOAL COMPLETE" screen in the video) and `ChallengeRewardScreen` (`src/components/economy/challenge-reward-screen.tsx`, the challenge settlement reveal which grants **box + embers**). Keep them consistent.

---

## §1 · Rays: TRUE full-screen — edge to edge, header + footer + all
The rays were enlarged but are **still not full-screen** (Noah, with screenshot): the ray burst **converges at a point below the flame**, leaving **dark top corners**, and **nothing renders under the status bar (header) or behind the Claim footer** — there are dark bands top and bottom. Noah: *"Needs to be entire phone screen, header and footer and all."*
- **Full-bleed overlay.** The reveal must cover the **entire device screen**, including **under the status bar / notch and under the home indicator**. Present it as a full-screen layer (`Modal` with `statusBarTranslucent` / an absolute layer at `StyleSheet.absoluteFill`) and **do not let a `SafeAreaView` clip the rays** — the rays layer ignores safe-area insets and paints corner-to-corner; only the *content* (X, balance, text, Claim) stays within the safe area, sitting **on top of** the rays.
- **No dark gaps.** Size + position the ray burst so wedges reach **all four corners**. Two ways: center the burst at **screen center** with `size = 2 × screenDiagonal` (guarantees full coverage regardless of the flame's position); or keep it anchored at the flame but make it large enough that the **top corners fill** too. Either way: no dark triangle at the top, no dark band behind the header or the footer. Rays behind the balance pill, behind the X, behind the Claim button.
- **Fire/animate:** bloom in + slowly rotate for the life of the reveal (`RewardRays` has this tuning in `reward-reveal.tsx`; make sure the animated values actually run here — a static fan means they aren't).
- Apply to **both** reveal screens (`GoalStreakRewardScreen`, `ChallengeRewardScreen`) and the shared `RewardRevealHost` if it caps size. Keep the `REVEAL_TUNING` tints.

> **Note on "no box to show" — decided:** the screenshot is a **DAILY GOAL COMPLETE** (Bath, +12 embers). **Daily goals pay embers only — no box, by design (Noah confirmed).** Do NOT add a box grant to daily goals. The **box-first-then-embers** format (§2/§3) appears **only on rewards that actually grant a box: challenge wins** (and rank-ups). §2/§3 are **not built yet** — this screen is still the old single "Claim · +12"; the box format will appear once §2/§3 land and the user wins a challenge. So on THIS (daily) reveal there is correctly just the embers step — the fix here is only the full-screen rays (§1).

## §2 · Reward format: BOX first, then embers
Noah: *"it doesn't show the format of how I want the rewards presented (box first, then embers)."* When a settlement grants **both** a box and embers (challenge rewards do), present them **in order: the box reward first, the embers second** — box on top / shown first in the sequence, embers after. The goal-complete reveal that only pays embers just shows the embers step. Order the `RewardRow`s / reward steps so **box precedes embers** everywhere a reveal lists rewards. (Badges/relics, if present, slot in their existing place — the key ask is box-before-embers.)

## §3 · Per-reward claim → fly to the top-right (box → inventory, embers → balance + smoke)
Today there's **one "Collect · +N"** button that grabs everything at once. Noah wants each reward **claimed on its own, with its own animation**, box first:
- **Claim the box →** the box art **drifts up to the top-right** (toward the inventory), then that step is done and the reveal advances to the embers. (A box flying to the inventory corner is the "it's in your bag now" cue.)
- **Claim the embers →** the embers **fly to the top-right balance** (the `EmberBalance` chip, `economy-bits.tsx`) **with the smoke animation** — the same **dissolve-into-smoke + ember drift** built for the sell flow (see `CODE_PROMPT_sell_flow.md` §2 / mock `100-sell-flow.html`): embers lift with soft smoke wisps, balance ticks up. Reuse `EmberFlight` + the smoke layer, don't rebuild.
- **Sequence:** box claim → box flies to inventory (top-right) → embers claim → embers fly to balance (top-right) with smoke → reveal dismisses. If a reward has only embers (daily goal), just the embers claim step. Each claim is its own tap with its own flight; the old single "Collect" becomes this two-step (box then embers) claim flow.
- **Authority unchanged:** the server already granted the box + embers at settlement (`grant_reward`); these claims are **presentation only** — the flights animate toward the real inventory/balance, and `requestInventoryRefresh()` reconciles the actual values on dismiss. Claiming animates; it does not grant. Reduce-motion: skip the flights/smoke, just advance and refresh.

## §4 · Wire the universal victory sound into the reveals (daily fire + challenge)
Noah: *"didn't we have a universal sound effect for daily fire / challenge complete / challenge victory? Wire that into the reward reveal."* We do — **`victory-fanfare.mp3`** + **`victory-fanfare-short.mp3`** exist and are registered (`sound.ts` cues `victory` / `victory-short`). But it isn't firing on these reveals:
- **`REVEAL_TUNING`** (`reward-reveal.tsx`) points **`daily_fire → 'ignite'`** (line ~111, with a comment "the daily fire is not a win") — so the daily-goal reveal is deliberately NOT using the universal victory. `challenge_solo/team/placement → 'victory'` and `pass_level → 'victory-short'` are correct.
- **`GoalStreakRewardScreen`** (the daily-goal reveal in the video) only fires **`RewardBurst cue="settle"`** (line ~161) — a quiet tick. It **never calls `playRewardSound`** with the tuning cue, so no fanfare plays at all.

**Do:**
- **Point daily_fire at the universal victory cue.** Change `REVEAL_TUNING.daily_fire.cue` from `'ignite'` to the universal victory — use **`'victory-short'`** for the daily (it fires often; the short cut suits the smaller daily beat) so daily fire, challenge, pass-level all share the one victory identity Noah means. (If Noah wants the *full* `victory` on daily too, it's a one-word change — flag the short-vs-full choice, default to short.)
- **Make the reveals actually play it.** In `GoalStreakRewardScreen`, on mount call **`playRewardSound(REVEAL_TUNING['daily_fire'].cue)`** (the fanfare) — keep or drop the quiet `settle` burst, but the victory cue must fire. Confirm **`ChallengeRewardScreen`** likewise fires its `victory` cue on mount (via `playRewardSound` or the shared host) — if it's silent like the goal screen, wire it the same way. One helper both bespoke screens call, so every non-rank-up reveal plays the universal victory once on mount, respecting the SFX/mute setting.
- **Do NOT touch rank-up** — it keeps its own `rankup` ladder.

**Done (§4):** completing a daily fire, a challenge, or a challenge victory plays the **universal victory fanfare** (short cut for daily) on the reward reveal — no more silent/`settle`-only daily reveal; rank-up untouched.

---

## Done
- Rays fire (bloom + rotate) and radiate to the screen edges on both reward reveals — not a small static fan.
- Rewards present **box first, then embers**.
- Box claim flies the box to the top-right (inventory); ember claim flies the embers to the top-right balance **with the sell-flow smoke + drift**; balance ticks; then dismiss. Server grant untouched; reduce-motion falls back to a plain advance + refresh.
- Reference: Noah's recording (goal reveal with the small static ray fan + single Collect), mock `100-sell-flow.html` (the smoke+ember flight to reuse).
