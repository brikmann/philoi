# Code Prompt — Challenge round 3 (reward timing + logic exploit + create-screen UI)

Noah's on-device pass on challenges. One product decision + several bugs/UI. On `integration-wave1`, one branch. Client/OTA except where a migration is called out (B, D). Report per item what was broken vs already working.

---

## §A · Product decision + build — fire the reward the moment it's achieved, with a SMOOTH transition into the rays
**Question (Noah):** should a challenge/goal reward screen fire *immediately during a lock-in session* the instant the target is hit (e.g. 10,000 steps mid-walk, or a custom "study hours for a class" goal), and it should be a **smooth animation into the rays like a rank-up — not a static screen that just appears — regardless of where the user is.**

**Recommendation (build this):** **Yes — fire it immediately on achievement, anywhere, via a smooth animated transition, routed through the shared reveal floor/queue.**
- **Why immediate:** the dopamine is strongest at the moment of achievement; deferring the celebration to the next time they open the Challenges tab (today's behavior — completion is only noticed on tab focus, see `challenges.tsx` ~line 157) wastes it. Hitting the target should celebrate then and there.
- **Smooth, not static:** the reveal must **animate in** — the rays bloom + the hero scales/crossfades up from the current screen, the way the rank-up celebration builds — rather than a hard cut to a finished rays screen. Reuse the rank-up celebration's entrance/transition approach so every reward reveal (daily fire, challenge, goal) shares that smooth build. (Pairs with `CODE_PROMPT_reward_presentation.md` — full-screen rays + this smooth entrance.)
- **Anywhere, without interrupting:** route through the existing **reveal floor/queue** (`useRevealFloor` / `RewardRevealHost`) so it can appear over any screen and **sequences** (never stacks on a rank-up or another reveal). During an **active lock-in** it's especially natural — the flame is already on screen, so the transition into the reward rays reads as the fire flaring up; keep it non-blocking (a Collect that returns you to the session, or auto-dismiss), and honor reduce-motion.

**Done (§A):** hitting a challenge/goal target fires its reward reveal immediately, from wherever the user is, animating smoothly into the rays (rank-up-style build), queued so it never stacks — including mid-lock-in without breaking the session.

## §B · 🔴 Stacking exploit — duplicate auto-tracked goals share one progress and each pay
Noah: *"you can set multiple 10,000-step goals for the week which all have the same progress. They'd all give the same reward — stacking."* Confirmed in the Personal tab (two identical "10,000 steps · WEEKLY · Auto" cards). Auto-tracked metrics (steps, Health Connect, etc.) read the *same* underlying number, so N identical goals all fill from one data source and each bank a reward — free multiplied embers.
- The goal-dedupe index exists — `goals_one_active_per_type_name` (0143): one active goal per (user, category, name). It's **not catching these**, either because these are created as **personal *challenges*** (not `goals` rows) and bypass the index, or because the auto metric/target isn't part of the uniqueness. **Trace which table these "personal step goals" live in** and enforce **one active auto-tracked goal per (user, metric, cadence)** — you cannot have two active auto goals racing the same source+window. Block creation of a duplicate (and surface a clear "you already have this goal" message), or collapse duplicates.
- **Manual-log goals** (e.g. custom pushups you log by hand) are exempt from the shared-source problem, but two identical auto goals must not both pay. Confirm the fix doesn't block legitimately different goals (10k daily vs 10k weekly are different cadences and both fine; two 10k weekly are not).
- Additive migration if a DB constraint is the fix; report snapshot age before any prod push.

## §C · Watch / live header is the wrong shade of purple
In the **Watch** and **live** challenge views (`src/app/watch/[challengeId].tsx` and the live/spectator surface) the header renders a **wrong shade of purple** vs the rest of the app. Fix it to the standard header/background token (`Colors` theme — match challenge-info / the other challenge screens). Audit both for the raw/off purple and unify.

## §D · Custom count challenge — gym-session reps should count toward it
A custom challenge made with Cindy ("track 1000 pushups in a day") has **no way for reps logged in a gym session to count toward it** — e.g. someone does 50 sets of 20. Right now the custom count goal only takes manual `+1`/"Log amount…" entries. **Add a path where a gym/lock-in session's logged reps feed the custom count goal**: when a session logs a count for a matching exercise/metric, credit it to the open custom count challenge (the same way auto metrics feed step goals). Follow the existing count-goal crediting (the `check_ins` trigger that banks "time locked in" custom goals — `0066`/relic feeder pattern) so session-logged reps roll into the custom target. Report what the wiring was and any migration needed.

## §E · "Challenge a friend" / "Personal goal" toggle is still old Philoi orange, not ember
`src/app/challenge/create.tsx` — the `kindTab` / `kindTabActive` segmented toggle (~lines 147-152) fills with the **old Philoi orange**, not the ember gradient the rest of the app now uses. Recolor the active tab to the ember/coral treatment (match the other primary selectors — "Start a challenge", the active metric chips). No raw legacy orange on this control.

## §F · Personal goal metric picker — replace the two sliding chip rows with a dropdown
On the **Personal goal** create screen, choosing what you track is **two horizontally-scrolling chip rows** (`RACE_METRIC_OPTIONS` / the metric selector) — Noah: *"two sliding bars… really weird, should just be a dropdown where you select what you're racing/tracking."* Replace the horizontal-scroll chip rows with a single **dropdown/select** listing the metrics (Steps, Study time, Gym visits, Workout minutes, Strain, Sleep, riding/Whoop, custom…). One clear picker, not two swipe rows. Keep the same metric set + the "More metrics" items; just change the control to a dropdown. (Consider the same for the friend-challenge race metric if it uses the same two-row pattern — flag it, but Personal goal is the ask.)

---

## Guardrails + Done
- One branch (`integration-wave1`); §A/§C/§E/§F client-OTA; §B/§D additive migrations on the one push path (report snapshot age first).
- §B is a 🔴 economy exploit — prioritize; verify legitimate distinct goals still work.
- Per item, report broken-vs-already-working.
