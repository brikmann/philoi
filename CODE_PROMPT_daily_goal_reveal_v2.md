# Code Prompt — Daily-goal reveal v2 polish (title size, subtext, claim smoothness, streak meter)

Follow-up to the daily-goal reveal simplification (`src/components/economy/goal-streak-reward-screen.tsx`). Noah loves the new stripped-down version — four tweaks. Client/OTA.

1. **Title is too small.** "DAILY GOAL COMPLETE: {GOAL}" (e.g. "DAILY GOAL COMPLETE: COLD PLUNGES") reads tiny. **Bump the font size** so it's a proper prominent title under the flame — it's the headline of the screen now, size it like one (larger, bold; wrap gracefully for long goal names).
2. **Drop the "Daily goal · easy target" subtext** inside the ember reward row. Keep just **"+{embers} Embers"** and the inline Claim — no difficulty/"daily goal" caption.
3. **The Claim animation is choppy.** Smooth it — the inline claim + the embers flying to the balance should ease cleanly (Reanimated `withTiming`/spring with a proper easing, not a stuttery interpolation). Make the tap→fly→balance-tick feel fluid; respect reduce-motion.
4. **Add a streak meter.** People complete daily goals *for* the streak, so surface it (the earlier tiny "1" badge was removed — this replaces it with something motivating, not that). Show the **current streak** (`award.streak`) as a small **fire/streak meter** — the count plus progress toward the next milestone bonus (`DEFAULT_MILESTONES` = 3/7/14/30 → +30/+60/+150/+400 embers), e.g. "🔥 4-day streak · 3 to the +60 bonus" with a little progress bar. Place it under the title / above or beside the ember row. It should make the streak feel like something worth protecting, not a bare number.

5. **The Claim button itself is off-brand + choppy.** It isn't the **ember UI** the app's other primary buttons use — give it the standard **ember-gradient treatment** (`PrimaryButton` / `EmberFill`, amber→coral), matching every other primary CTA. And its press/animation is **choppy** — smooth the button's own interaction (press state, any fill/scale animation) so it feels fluid like the rest, not just the ember flight in #3.

**Done:** bigger title; no "easy target" caption; the Claim button uses the ember gradient like every other primary CTA and animates smoothly; smooth ember flight; a streak meter showing the current streak and progress to the next milestone bonus.
