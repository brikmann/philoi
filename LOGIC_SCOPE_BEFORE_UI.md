# Logic scope — what's done, what's left, before we move to UI
_Ground truth from the migrations + code on `add-marketing-site`, 2026-08-27. "Shipped" = a migration file / code path exists in the tree. "Spec only" = a doc exists, zero code. This corrects a few task-list entries that read "completed" but are actually spec-only._

---

## 1 · Shipped — logic that's actually in the codebase
These have migration files or code paths and are real:

- **Challenge engine v2** — foundation, no-autostart, draft visibility, watch-status, participant-aware settlement, loop repair, reward reveal (`0096–0099`, `0111`, `0112`, `0118`). Includes H2H **draw handling** (`0111`: two-person draw gives both credit).
- **Goal credit** — lock-in time goals credited via an AFTER-INSERT trigger on `check_ins` (`0113`), plus goal-drip on completions (`0116`) and count-mode hours (`0117`). ➡️ This means **task #66 is effectively done** (it's marked pending).
- **Milestones** — `0093` with `friends / campus / public` visibility + `milestone_cheers` + `can_see_milestone`. **This is the Agora's substrate — already built.**
- **Rewards economy** — inventory, boxes, published odds, salvage (`0064`), reward calibration (`0083`). Loot-box odds ARE disclosed in-app (verified: `shop/box/[boxKey].tsx`).
- **Ranks / seasons** — prestige + season close + `rank_up_events` table (`0066`), end-of-season placement + trophy hall (`0092`).
- **Relics** — earned tracking + drop-pool guard (`0090`), trophy hall/collection (`0092`). ⚠️ but see §2 — the *progress feeder* is not built.
- **Cindy / AI coach** — backend (`0101`) + `coach/` functions, **including Google Calendar as coach context** (`coach/gcal.ts`, `0105`). ➡️ GCal is wired — **task #117 is largely done**.
- **Fitness** — Strava (`0035`), synced-activity detail (`0046`), Whoop reapply (`0115`).
- **Push** — rich push + bell + backfill (`0087`/`0088`), challenge result events (`0089`).
- **Social plumbing** — campfire roles + join requests (`0094`), report readback (`0095`), campfire stats/live challenges (`0100`), bio + journal (`0091`), cheer notes (`0110`).

---

## 2 · Written but NOT shipped — the LOGIC_AUDIT gap (do first)
These were **drafted in `CODE_PROMPT_logic_fixes.md` / `LOGIC_AUDIT_2026-08.md` as migrations 0119–0122, but no such files exist** in `supabase/migrations/` (tree stops at `0118`). The task list marks some "completed" — that means *spec written*, not *shipped*. **This is the highest-priority logic work before UI, because the UI will render these states.**

- **Relic progress tracking (0119)** — steps→km conversion + feeding every discipline ladder. No `relic_progress` / `update_relic` function exists. **Relics can be earned but nothing feeds their progress.** ➡️ task **#123 is spec-only, not done.**
- **`session_complete` push (0120)** — no session-complete → push path exists. The Strava-style "session complete" notification isn't wired. ➡️ part of **#125**, spec-only.
- **Rank-up reward grant (0121)** — `rank_up_events` are *recorded*, but nothing *grants embers + a box* on division/tier rank-up. ➡️ task **#105 says "SPEC'D"** — correct, still needs building.
- **H2H tie handling (0122)** — `0111` already pays both on a two-person draw; confirm whether the 0122 intent (ties pay both in all shapes) is fully covered or still needs the group-challenge case. Likely **partially done — verify.**
- **Forge Pass achievements on home + ember grant (0124)** — `forge_pass` exists as an ember/item source enum (`0064`), but confirm the home surfacing + milestone-ember grant actually fire. Marked done (#124) — **verify, don't assume.**

**Recommendation:** create these as real migrations `0119`+ and deploy them as one "logic-audit" batch before any UI depends on them.

---

## 3 · Spec only — features with zero code (need a backend build)
Docs exist and are good; nothing is built. These are the newest scope and each needs tables + functions before its UI:

- **The Agora** (`AGORA_SPEC.md`, mock 160 + 161) — needs `agora_posts` + `agora_comments`; reuses milestones + `milestone_cheers` + `can_see_milestone`. **Lightest lift of the three** because the substrate is shipped — it's mostly a feed query over milestones at the chosen visibility scope.
- **DMs / Ping** (`MESSAGING_DM_SPEC.md`, mocks 151–153) — `messages` is campfire-scoped (`group_id`); **no DM tables**. "Ping" today is just the challenge-invite friend-picker (`people.tsx`), not messaging. Needs new 1:1 message tables + Ping types.
- **Vouching / wagered rewards** (`CHALLENGE_CINDY_SCOPING.md`, mocks 141–142) — **zero code** for `challenge_vouches`, collusion caps, or ember wager/stake on challenges.
- **The Forge (crafting sink)** (`FORGING_SPEC.md`, mocks 155–156) — **unbuilt.** No `forge_cosmetic()` / `stoke_reroll()`. Salvage exists; the craft-up sink does not. (The menu already links it — mock 161.)
- **Cindy-authored challenges + governance** (`CHALLENGE_CINDY_SCOPING.md`, mocks 140/143–150) — Cindy *coach* is built, but the **challenge-authoring** layer (metric taxonomy, custom lock-in types, roles, bidirectional proposals) is spec-only.
- **Grade rewards + Class Goal Tracker / Grade Calculator** (`GRADE_REWARD_SPEC.md`, task #72) — **unbuilt.** (`0014 class_campfires` is class-named campfires, not grade rewards.)

---

## 4 · Open logic bugs / blockers to clear before UI polish
From the task list, these are logic-level and will corrupt any UI built on top of them:

- 🔴 **#78** — deploy `0069`: box opens throw "expected JSON array" (loot box open is broken).
- 🔴 **#74** — ×10 vault crash at the results screen.
- 🐛 **#42** — gym lock-in → purple splash freeze (hard blocker).
- **#43** — Strava stuck on "coming soon" (root cause: `FITNESS_SYNC_ENABLED=false`).
- **#75** — Buy Direct weekly rotation + countdown.

---

## 5 · Task-list corrections (so "done" means done)
- **#123** (relic progress) → not done, spec-only. See §2.
- **#125** (push on unlock/rankup/session-complete) → partially done; `session_complete` push not shipped.
- **#105** (rank-up rewards) → correctly "SPEC'D"; still to build.
- **#66** (goal credit in `check_ins` trigger) → **done in `0113`**, can close.
- **#117** (GCal → coach) → **done** (`coach/gcal.ts`); can close pending final deploy check.

---

## 6 · Recommended order into UI
1. **Ship the §2 batch** (relics feeder, session-complete push, rank-up grant, verify Forge-Pass grant) as migrations `0119`+ — the reward/relic/rank UI has real state to render.
2. **Clear §4 blockers** (0069, ×10 crash, gym freeze, Strava flag) — no point styling broken flows.
3. **Build The Agora backend** (§3, lightest — substrate exists), since it's the current UI target.
4. Sequence the heavier unbuilt features (DMs/Ping → Vouching → Forge crafting → Cindy authoring → Grade rewards) each as backend-then-UI, not before.
5. Then move to the UI pass (cosmetics landing #127/#132, campfire/challenge polish #133, settings cleanup #134).

**One-line status:** the reward/challenge *engine* is shipped; the *feeders and grants* around it (relics, rank-up, session-complete) are written-but-not-shipped; and the three headline social features (Agora, DMs, vouching) are still spec-only. Agora is the smallest gap to close first.
