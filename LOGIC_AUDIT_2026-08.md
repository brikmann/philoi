# Philoi — Background Logic Audit & Fix Plan
_Aug 2026 · covers relics, rewards/Forge Pass, campfire/challenge, push, settings._

Verdict per area, with file/line evidence, the gap, and the fix. Nothing here is applied yet — this is the diagnosis for you to gate. Migration drafts land as `0119+`; client changes are called out per file.

---

## 1. Relic progress tracking — ❌ STALE + INCOMPLETE (biggest gap)

**What's wired:** `economy_evaluate_relics(user)` in `0090_relics_earned_and_drop_pool_guard.sql` grants relics, fired by a trigger on `lock_in_sessions` status changes. `economy_grant_relic()` is idempotent and pushes a bell event on unlock.

**The problem — it evaluates the OLD relic set, not the current catalog.** 0090 still checks:
- Hestia's Hearthstone (30-day streak) — **you retired this.**
- Icarus' Feather — "Reached **Gold**" — catalog now says **reach Hero**.
- Prometheus' Shard — "Top **1%** of a season" — catalog now **top 10% + refer someone**.
- Athena's Aegis — "A full month with no dead days" — catalog now **6 consecutive weeks**.
- Anvil of Hephaestus — 500 hours ✓ (this one matches).

**And these have NO evaluation logic at all:**
- **Zeus' Bolt** (reach Primordial) — not present.
- **Atlas' Burden** (1000lb club: bench + squat + deadlift ≥ 1000lb) — not present.
- **Discipline ladders** — Volume (lbs), Distance/Movement (km), Hours — **none of the tiered thresholds are evaluated.** The data exists (`gym_sets.weight×reps`, `check_ins.distance_m`, `lock_in_sessions` hours) but nothing sums it lifetime and grants ladder rungs.

**Steps → km is not wired.** Distance relics read `check_ins.distance_m`, which is only populated by Strava run/ride (`0038`). Step-only sources (HealthKit / Health Connect land as `check_ins` type `'steps'`) never estimate into `distance_m`, so walking never feeds the km tracker — exactly the case you called out.

**Trigger blind spot.** The relic trigger fires only on `lock_in_sessions` status updates. A pure fitness-sync day (steps/distance via `check_ins`, no lock-in) never re-evaluates relics.

### Fix — migration `0119_relics_recatalog_and_discipline_ladders.sql`
1. Rewrite `economy_evaluate_relics()` to the current catalog: retire Hestia; Athena = 6 consecutive ISO weeks with ≥1 completed session; Icarus = rank ≥ Hero; Prometheus = top-10% season finish **AND** ≥1 successful referral; Zeus' Bolt = rank = Primordial; Anvil = 500h (keep).
2. Add **Atlas' Burden**: max e1RM-agnostic — sum best working set of any bench variation + any squat variation + any deadlift variation from `gym_sets`; grant mythic when ≥ 1000 lb. (Per `CODE_PROMPT_atlas_burden.md`.)
3. Add **discipline ladders** as tiered grants (α→Ω, rarity per catalog):
   - Volume: lifetime Σ(weight×reps) → 10k/25k/50k/100k/250k = U/R/E/L/M.
   - Distance: lifetime Σ(distance_m)/1000 → 50/100/250/414 km = R/E/L/M.
   - Hours: lifetime Σ(session hours, Study+Deep Work+Meditate) → 10/25/50/100h = U/R/E/L.
4. **Steps → km estimate:** on `check_ins` insert of type `'steps'` with null `distance_m`, set `distance_m = steps × stride_m` (default **0.75 m**, configurable). Feeds the Distance ladder.
5. **Widen the trigger:** also evaluate relics `after insert on check_ins` (fitness-only days), not just `lock_in_sessions`.

> Decision needed: stride constant (0.75 m default) — accept or set your own?

---

## 2. Forge Pass achievements on home + ember transparency — ❌ MISSING on home

**What's wired:** Season/level claims exist (`0074_season_window_and_level_claims.sql`); goal-completion embers drip (`0116`); `grant_reward` pays embers/box/badge and its payload is now readable (`0118`).

**The gap:** `src/app/(tabs)/index.tsx` renders greeting · Cindy hint · streak · campfire valley map · active-challenge chip · join/create. **There is no panel showing Forge Pass achievements or what earns embers/XP.** Users can't see from home what actions reward them — your explicit ask.

### Fix — client, `src/app/(tabs)/index.tsx` + new `src/components/home/forge-pass-strip.tsx`
- Add a compact **"Earn embers today"** strip on home: 3–4 live achievement rows pulled from the pass track (e.g. "Lock in 60 min → +X✦", "Complete a challenge → rare box", "Hit your daily fire → +X✦"), each showing progress + reward. Tapping opens the Forge Pass.
- Source from the existing season/level-claim tables; no new economy math, just a read + render.
- Mock first (recommend a quick mock before build) so placement vs the campfire map is right.

---

## 3. Campfire + challenge reward logic — ✅ SOUND IN CODE · ⚠️ DEPLOYMENT-GATED

Solo (personal goal), duels (H2H), and groups all handled. Pre- (create/accept notify), intra- (`cheer_challenge` push), and post- (settle → `grant_reward` → `challenge_settled`/`campfire_settled` push + reward reveal) all fire.

- `0111` participant-aware settlement · `0112` loop repair (roster = one definition) · `0114` grant_reward enum-cast fix · `0118` reward reveal readback.
- Your example (group: study X course 5h/week for a month → rare box) maps to `create_group_challenge` → `economy_on_social_challenge_closed` → `grant_reward(..., 'campfire_group', ...)` which grants the box. ✓

**The only risk is deployment state**, not logic: the prior sweep flagged **0112 missing in prod** (schema jumped 0111→0113) and **grant_reward had never returned successfully until 0114**. If 0112/0114 aren't deployed, nothing settles or pays.

### Fix — verify + deploy (no code change)
- Confirm `schema_migrations` contains 0112, 0113, 0114, 0118 in prod. If 0112 is absent, that's the merge gap from the campfire branch — push it.
- Smoke test: create a 2-person group challenge, force-settle, confirm embers + box land and both get the `campfire_settled` push + reward reveal.

---

## 4. Push notifications on key events — ⚠️ PARTIAL

Pipeline is solid (`notify_event` → bell row + eligible push, category toggles, quiet hours).

| Event | State | Note |
|---|---|---|
| Unlock relic | ✅ fires | but **generic copy** — title "Relic earned", body = reason. Not Strava-custom per relic. |
| Rank up | ✅ fires | `ranked_up` emitted in season/close paths. |
| Challenge/campfire settled | ✅ fires | see §3. |
| **Session completed (Strava-style self recap)** | ❌ **missing** | No `session_complete` self-notification. `friend_locked_in` notifies *friends*, not you. A "you locked in 1h 20m — nice work" recap does not exist. |

### Fix
- **`0120_session_complete_push.sql`:** add event type `session_complete`; emit from the session-finalize path (on `lock_in_sessions` → completed) to the **session owner** with a custom recap (duration, type, XP earned, streak). Map it to a category (`streak_reminders`) so it honors toggles. Note: `notify_event` suppresses self-notifications when `actor_id = recipient` — pass `actor_id = null` so a self-recap is allowed.
- **Custom relic copy:** in `economy_grant_relic`, replace "Relic earned" with per-relic name + flavor (e.g. "⚡ Zeus' Bolt — the king himself bows toward your greatness."). Pull from a small relic-copy map.

> Decision needed: session-complete push — every completed session, or only ≥ some minimum (e.g. 25 min) to avoid spam?

---

## 5. Settings + notification toggles — ✅ MOSTLY THERE · minor cleanup

`src/app/settings-notifications.tsx` exposes master · 5 `cat_*` categories · daily reminder time · quiet hours. The pipeline reads `cat_<category>`.

**Cleanup:**
- Once §4 lands, confirm `session_complete` maps to a visible toggle (streak_reminders) so users can mute recaps.
- Verify category **labels** match the five the user sees (Friends & social · Challenges · Campfires · Streak & reminders · Season & rank).
- General settings screen (`settings.tsx`) tidy pass is a UI task (#128), not logic.

---

## Priority order
1. **P0 — Deploy/verify 0112 + 0114** (§3). Without it the whole reward loop is dead in prod. Fastest, highest impact.
2. **P0 — `0119` relic recatalog + discipline ladders + steps→km** (§1). Largest correctness gap; the relic system currently grants the wrong things.
3. **P1 — `0120` session-complete push + custom relic copy** (§4).
4. **P1 — Forge Pass "earn embers" strip on home** (§2).
5. **P2 — Settings label/toggle cleanup** (§5) + UI passes (#128).

Two decisions to unblock me: **(a)** steps→km stride constant (default 0.75 m), **(b)** session-complete push threshold (all vs ≥25 min).
