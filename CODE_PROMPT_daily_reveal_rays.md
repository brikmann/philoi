# Code Prompt — The rays don't fire on the goal-complete reveal (wire the daily/challenge reveals to RewardRays)

**Bug (from Noah's screen recording):** clearing a goal ("Cold plunge" personal goal) shows the **"DAILY GOAL COMPLETE · Goal cleared, {name}"** reveal with +12 embers and Collect — but the flame sits on a **bare dark background for the full ~7s with no rays behind it.** The reward-rays that every payout is supposed to fan out never render here.

**Root cause — two parallel reveal systems, and this screen is on the old one.**
- `src/components/economy/reward-reveal.tsx` is the **shared rays system** (#184): `REVEAL_TUNING` (with `daily_fire: { tint: Colors.coral, rays: 12, scale: 0.92, eyebrow: "TODAY'S FIRE" }`), the exported **`RewardRays`** component (a rotating fan of soft wedges, `export function RewardRays({ kind, size })` ~line 123), and `RewardRevealHost` which renders `<RewardRays kind={event.kind} …>` behind its card.
- The goal-complete screen the video shows is **`GoalStreakRewardScreen`** (`src/components/economy/goal-streak-reward-screen.tsx`), rendered inline by `src/app/(tabs)/challenges.tsx` (~line 279). It imports `PersonalFlame` + `RewardBurst` + `RewardRow` and renders the flame crest as just `<View style={styles.crest}><PersonalFlame size={104}/> …</View>` (~line 128). **It never imports or mounts `RewardRays`.** It predates the rays system and was never migrated onto it — so the payout/copy/burst land but the persistent rays fan is absent. (The `RewardBurst` at line 119 is a one-shot that fires on mount and fades — not the rays.)

---

## §1 · Fire the rays on the goal-complete reveal (the video)
In `GoalStreakRewardScreen`, mount **`RewardRays`** behind the flame crest:
- Import `RewardRays` from `@/components/economy/reward-reveal`.
- Make the `crest` view a relative container and place `<RewardRays kind="daily_fire" size={~260} />` **absolutely centered behind** `PersonalFlame` (behind in z-order, `pointerEvents="none"`), so the coral fan radiates out from behind the flame the way `RewardRevealHost` does behind its card. Size it to bloom past the 104px flame (the host uses `340 * tuning.scale`; scale down to fit this crest — ~240–280).
- Keep the existing `RewardBurst`, streak bubble, copy, rows and Collect — this is purely adding the missing rays layer. Result: the reveal reads like the other rays reveals — flame with a live coral ray fan behind it, not a flame on black.
- Respect reduce-motion the same way `RewardRays`/the host already do (if the shared component honors it, you get that for free).

## §2 · Audit the other bespoke reveals for the same gap
Since the rays were bolted on as a shared layer, any reveal that didn't route through `RewardRevealHost` may have missed them. Check and wire consistently:
- **`ChallengeRewardScreen`** (`src/components/economy/challenge-reward-screen.tsx`) — the settled-challenge reveal (via the settlement watcher). Confirm it renders `RewardRays` for its kind (`challenge_solo`/`challenge_team`/`challenge_placement` per `REVEAL_TUNING`). If it shows the reward on a bare background like the goal screen did, mount `RewardRays kind={<its kind>}` behind its hero the same way. **This is likely the same bug** — Noah called the goal reveal "the challenge reward," and the challenge settlement reveal is a sibling screen that may share the omission.
- Spot-check `pass_level` and any rank-up-adjacent reveal render through the rays (rank-up already has its bespoke celebration — leave that).
- Report which reveals already had rays vs which were missing them.

---

## Done
- The goal-complete reveal ("DAILY GOAL COMPLETE / Goal cleared") fires the coral `daily_fire` rays behind the flame — no more flame-on-black.
- `ChallengeRewardScreen` (and any other non-host reveal) fire their tuned rays too; report the audit.
- Purely additive rays layer — payout math, copy, burst, Collect, streak banking all untouched. Client/OTA on `integration-wave1`, no rebuild. Reduce-motion honored via the shared `RewardRays`.
- Reference: Noah's recording (goal-complete reveal, ~0:25–0:32, flame with no rays).
