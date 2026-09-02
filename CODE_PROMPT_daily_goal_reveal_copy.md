# Code Prompt — Strip the daily-goal reveal down to rays + one ember row

Noah wants the goal-complete reveal (`src/components/economy/goal-streak-reward-screen.tsx`) radically simplified. Keep the rays + flame + brand-purple background; cut everything else down to a title and one claimable ember row. Client/OTA.

Do all of the following on `GoalStreakRewardScreen`:
1. **Title = the goal.** Replace the eyebrow "DAILY GOAL COMPLETE" + the streak-number badge on the flame with a single line: **`DAILY GOAL COMPLETE: 10,000 STEPS`** (the goal's target + metric). Remove the **"1" streak badge** on the flame entirely. (Compose from the goal's target + unit — `goalLabel` gives the metric; if the award doesn't carry the target number, thread it through from the goal.)
2. **Remove the headline + subline.** Delete **"Goal cleared, {name}."** and the subtext **"{goal} · today · 🔥 {streak}"**.
3. **One reward row, with Claim inside it.** Keep only the **"+{embers} Embers"** row. Put the **Claim action inside that row, where the "→ wallet" destination text currently sits** — i.e. the ember row's right side becomes the Claim button (ember/orange). Tapping it runs the existing claim.
4. **Remove the breakdown line** "+{N} today (easy goal). Keep the streak → 3-day banks +30."
5. **Remove the bottom "Claim · +{total}" CTA** — claim now lives in the ember row (#3), so the footer button goes.
6. Keep "Share to your story" if it's there; keep the rays, flame, and the ScreenBackground brand purple.

**Result:** rays + flame + **"DAILY GOAL COMPLETE: 10,000 STEPS"** + a single **+12 Embers** row with an inline Claim on its right. Nothing else.

**Done:** the daily reveal is just the title (goal + target) and one claimable ember row; no streak badge, no "Goal cleared" headline/subline, no breakdown, no bottom CTA.
