# Decisions — campfire #3 (reward screen) + app-sweep #7 (goal-day drip)

Resolves the two "needs your call" ledger items. The apply passes implement these; nothing here is a
re-decision. Both are economy-touching, so honor the firewalls (server-authoritative reward math; Cindy grants
nothing; grades/milestones 0 XP).

---

## Campfire #3 — wire `ChallengeRewardScreen` + `ChallengeWinShareCard` (owner: campfire apply pass)
Both components are built with **zero call sites**; the result arc currently ends at the Final standings block.
Wire them per mock 47.

**When it fires — once, then never again.**
- Trigger on the **first view of a settled challenge the user was a participant in** — reached either by the
  `challenge_won` push deep-link or by opening challenge-info after settlement.
- Persist a per-user-per-challenge seen flag: add **`challenge_participants.reward_seen_at timestamptz`**
  (new migration, forward-only). Client logic: `settled && is_participant && reward_seen_at IS NULL` →
  present `ChallengeRewardScreen`; on dismiss, stamp `reward_seen_at = now()`. Every later view → the standings
  block (item 2), not the reveal.
- **Losers/non-winners:** still get the reveal once (their placement + any consolation), then standings. It's a
  results screen, not only a victory screen.

**Where the reward payload comes from — new RPC.**
- `get_challenge_results` returns XP only. Add **`get_challenge_reward(p_challenge_id uuid)`** returning, for
  `auth.uid()`: `placement`, `xp` (from `bonus_xp_awards`), `embers` (ember ledger rows with reason
  `challenge_win`/`season_reward` keyed to this challenge), `box` (`loot_boxes.obtained_via = <challenge>`),
  and `badge`/`band` if `grant_reward` wrote them. This reads exactly what `grant_reward` paid — so it can't
  show a reward that didn't land (which is the whole point of fixing #1 first).
- `ChallengeRewardScreen` renders that payload; `ChallengeWinShareCard` takes `placement` + the headline stat.

**Share card is not one-shot.** Primary CTA on the reward screen is **Share**; the standings block also keeps a
**Share** affordance so a racer can re-share later. (Matches the "advertise your wins" ethos — see PROFILE_SPEC
milestones.)

**Depends on:** #1/#2 (roster + `final_*` written) and #1's `grant_reward` fix, or the payload RPC reads empty.

---

## App-sweep #7 — goal-day drip for lock-in-credited goals + the custom value (owner: sweep apply pass)
Two coupled pieces.

**1. Set the custom-goal difficulty = `easy` (floor, 12/day).** 🔴 DECIDED.
- Today `economy_config.goal_difficulty.custom = {"moderate":0,"ambitious":0}`, and because `0` isn't `null`
  the tier resolver (0085) falls through and scores **every** custom goal as *ambitious* → the top 25/day drip.
- A custom goal is free-text and self-defined ("read 10 pages", "meditate") — no comparable unit to tier by,
  and unverifiable. So it pays the **floor**: `easy`, **12/day**. Anti-cheese: no "custom goal: breathe →
  25/day".
- Implement by making `custom` resolve to `easy` explicitly in the tier CASE (don't rely on the `0/0`
  sentinel). New forward-only migration.

**2. Fire `awardGoalDay` for lock-in-credited completions (parity).**
- `logChallengeProgress` calls `awardGoalDay` on server `just_completed` (`challenges.ts:71`), but
  `creditLockInTimeGoals` returns a bare count — so a time-counted goal completed **by a lock-in** never pays
  the goal-day drip that the same goal completed **by a hand-logged entry** does.
- Fix: `creditLockInTimeGoals` reports `just_completed` like the hand-logged path, so `awardGoalDay` fires.
  Now safe because the custom drip is bounded to `easy` by piece 1.
- **Gate:** only meaningful after **#1 (`0114` grant_reward)** deploys — the award path can't actually pay
  until then. Deploy in the `0112 → 0113 → 0114 → 0115` train, this fix after `0114`.

**Companion — approve #6 too (recommended).** #7 rarely *triggers* without #6: the lock-in goal picker
(`lockin-goal-picker.tsx`) matches the goal by exact free-text, with no hint. Offer the user's `lockin_time`
goals as **tappable chips** on that field so the match is guaranteed. Without it, the drip you just enabled
almost never fires. Small UI change — recommend approving alongside #7.

---

## Canonical config (record)
- `goal_rewards.daily` unchanged: `{easy:12, moderate:18, ambitious:25}` (0083).
- `goal_difficulty.custom` → resolves to **`easy`** (this decision). Update `CHALLENGE_REWARD_ALGO.md` §drip.
