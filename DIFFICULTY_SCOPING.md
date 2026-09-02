# Free-text goal difficulty scoping (extends CHALLENGE_CINDY_SCOPING.md + CHALLENGE_REWARD_ALGO.md)

_How Cindy scopes an **arbitrary, described** goal — "learn a backflip", "run the Toronto Marathon", "hold a handstand" — to a real rarity tier, instead of flooring every custom goal at Uncommon._

---

## The bug this fixes

Today **every** solo/duel/campfire custom goal pays an **Ignition Crate (Uncommon)** — a backflip and a 10-minute walk reward the same. That's not a rendering bug, it's the **current policy working as designed**: `CHALLENGE_REWARD_ALGO.md` and migration `0116` deliberately hard-code `when goal.type = 'custom' then 'easy'` — the floor — because "custom goals are free-text and self-defined, so there's no unit to tier them by and no way to verify."

That was the right *anti-cheese* call and the wrong *ambition* call. We keep the anti-cheese (below) but replace the flat floor with **Cindy scoring the intrinsic difficulty of the described feat** — scoped to how hard it actually is for our demographic (**18-20 y/o, Gen Z, average starting fitness**). A genuinely hard skill pays like one.

**The two anchors Noah gave, resolved by this doc:** `learn a backflip → Epic`, `run the Toronto Marathon → Legendary`.

---

## Difficulty model — two axes, one tier

Cindy scores a specific, described goal on two axes and reads the tier off the grid. Both axes are about the **median 18-20 Gen Z with average starting fitness, training with reasonable consistency** — not an athlete, not a couch case.

- **T — Time-to-competence:** from a standing start, how long to first achieve it. (same day → a week → weeks → months → most of a year → a year+)
- **A — Attainability:** of the people in the demographic who *genuinely try*, what share ever get there. (nearly all → most → about half → a minority → a rare few → a tiny elite)

A **barrier bump (+1 sub-step, never a full tier)** applies when the wall is fear, pain, or a hard technical gate rather than plain repetition — the backflip's the classic case (the limiter is flipping backward, not strength).

### The grid → tier → box (reuses the real boxes from CHALLENGE_CINDY_SCOPING.md)

| Tier | T (median 18-20 to first achieve) | A (who ever get it) | Box | Reads as |
|---|---|---|---|---|
| **Common** | Same day, zero training | ~everyone | *(no box — embers only)* | a daily habit / micro-goal |
| **Uncommon** | A day to ~1 week, light effort | most | **Ignition Crate** | "a solid push this week" |
| **Rare** | ~2–6 weeks consistent | more than half who try | **The Furnace** | "a real training block" |
| **Epic** | ~2–4 months, skill/fear/strength barrier | a minority ever land it | **Vessel of Hestia** | "most people never do this" |
| **Legendary** | ~5–12 months sustained, high barrier | a rare few | **Hephaestus' Chest** | "a genuine life feat" |
| **Mythic** | 1 year+ elite / near-competitive | a tiny % of the population | **Promethean Vault** | "elite / bragging-rights-for-life" |

Payout per tier (embers + Pass XP) is the existing table in `CHALLENGE_CINDY_SCOPING.md §"The reward algorithm"` — this doc only decides **which tier** a described feat lands in. Duration/scope multiplier and the duel/campfire competitive premium stack on top exactly as they already do (significance × scope × duration × placement).

---

## Calibration table — the effort estimates (Cindy's few-shot anchors)

Estimates are for a **median 18-20 Gen Z, average starting fitness, ~3 sessions/week of consistent effort**. Sourced anchors are footnoted; the rest are reasoned off them. **This table is also the anchor set Cindy is few-shot-prompted with** — keep it as the single source of truth and grow it as real goals come in.

### Common — same day, ~everyone
| Goal | Effort estimate | Why Common |
|---|---|---|
| Drink 3 L of water today | minutes of attention | no barrier, universal |
| 10-minute walk | 10 min | trivial |
| Read 15 pages | 15–25 min | trivial |
| Make your bed today | 2 min | habit micro-goal |
| 20 push-ups across the day | one easy session for most | near-universal in sets |

### Uncommon — a day to a week, most people *(the old floor — still the default for vague/light goals)*
| Goal | Effort estimate | Why Uncommon |
|---|---|---|
| Hit 10k steps in a day | 1.5–2 h of walking | doable, takes real intent |
| 50 push-ups in a day (across sets) | one committed day | most can with rest sets |
| Study 3 focused hours | one disciplined day | effortful, not hard |
| **Run a nonstop 5k — if already active** | today, or a couple of sessions | active people are near it now |
| 7-day streak of any daily goal | a week of showing up | consistency, low skill |

### Rare — 2–6 weeks consistent, more than half who try — **The Furnace**
| Goal | Effort estimate | Why Rare |
|---|---|---|
| **Run a nonstop 5k from the couch (C25K)** | **8–10 weeks inactive / 4–6 weeks reasonably fit** ¹ | a real block, but a designed on-ramp most finish |
| First **1 strict pull-up** from zero | weeks–2 months (only ~17% of men, ~5% of women can do one cold) ² | strength gate, trainable |
| Hold a **2-minute plank** | 2–4 weeks | pure grind, attainable |
| Solve a Rubik's cube (any method) | days–2 weeks of practice | learnable skill, low physical risk |
| Learn to play one song on guitar (beginner) | 2–6 weeks | skill + calluses, no hard gate |

### Epic — 2–4 months, real barrier, a minority ever land it — **Vessel of Hestia**
| Goal | Effort estimate | Why Epic |
|---|---|---|
| **Learn a standing backflip** | **3–9 months true beginner / 6–12 weeks if athletic; limiter is the fear of flipping backward** ³ | skill + fear barrier, many never land it → **Noah's anchor** |
| **Freestanding handstand (10-second hold)** | **6–9 months average / 3–6 months athletic** ⁴ | balance skill, months of daily reps |
| **10 consecutive pull-ups** | 3–6 months from a low base | strength ceiling most never hit |
| Run a **half-marathon (21.1 km)** | 10–14 week plan | big endurance block, well short of a full |
| **Muscle-up** (with a pull-up base already) | **8–12 weeks with prerequisites** ⁵ | technical + strength gate |
| Bench-press your bodyweight | 3–5 months untrained | serious strength milestone |

### Legendary — 5–12 months sustained, a rare few — **Hephaestus' Chest**
| Goal | Effort estimate | Why Legendary |
|---|---|---|
| **Run a full marathon (e.g. Toronto Marathon)** | **16–20 week plan; <1% of people ever finish one** ⁶ | life feat, huge sustained grind → **Noah's anchor** |
| **Strict muscle-up from scratch** (no pull-up base) | **6–18 months** ⁵ | build the base *then* the skill |
| Squat 2× bodyweight | 1–2 years serious training | elite-adjacent strength |
| One-arm-pull-up *progression* (assisted → near) | ~1 year+ | very few ever approach it |
| Learn a language to conversational (A2→B1) | 6–12 months consistent | sustained cognitive load |

### Mythic — 1 year+ elite / near-competitive — **Promethean Vault**
| Goal | Effort estimate | Why Mythic |
|---|---|---|
| Sub-3-hour marathon | years; a few % *of marathoners* | elite even among finishers |
| A full **one-arm pull-up** | years for most who ever get it | rare-air strength |
| Standing **double backflip** | elite tumbling | tiny population |
| 500 lb / 225 kg deadlift | years of dedicated lifting | competitive-adjacent |

> **Footnoted anchors** (see Sources): ¹ C25K is an 8–10 wk beginner plan (4–6 wk if already fit). ² ~17% of men / ~5% of women can do a single strict pull-up. ³ standing backflip 3–9 mo for a true beginner, 6–12 wk if athletic; the gate is the backward-flip fear, not strength. ⁴ freestanding 10-second handstand 6–9 mo average, 3–6 mo athletic. ⁵ muscle-up 8–12 wk *with* a pull-up/dip base, 6–18 mo from scratch. ⁶ marathon = 16–20 wk plan; under 1% of the global population has ever finished one.

---

## Anti-cheese — why scoping high doesn't let people mint Legendary crates

Scoping "run a marathon" as Legendary would be reckless **if typing it granted a Legendary crate**. It doesn't. Two gates already in the app do the work — this doc just points the difficulty score *through* them instead of flooring it.

**1. The verifiability discount (already built — `CHALLENGE_CINDY_SCOPING.md §Verification).** The *tier* Cindy scopes is the **achievement tier**; the *paid* reward runs through the honor gradient:

| Path | What it is | Payout |
|---|---|---|
| **Auto** | app-tracked (Strava marathon, step count, workout volume) | **full tier**, no trim |
| **Vouched** | self-reported + 1–2 friends confirm (or a photo/video) | full box tier, **−10% currency** |
| **Unvouched** | self-reported, nobody confirms | **box −1 tier**, **−20% currency** |

So a **claimed-but-unproven backflip** (Epic) pays **Unvouched = Rare (The Furnace) −20%** until a clip or a friend vouches, which upgrades it to the full Epic box. A **Strava-synced marathon** (Auto) pays full Legendary; a marathon you merely *type* "done" on pays the discounted, un-upgraded path. **You can never mint a top box by describing a hard thing** — you mint it by doing the checkable version. This is the whole point of the gradient, and it's why we can safely let the ceiling be high.

**2. The measurability gate.** A goal must be **specific and checkable** to score above Uncommon. Vague grandiosity ("get shredded", "be good at guitar") is **floored at Uncommon** and Cindy offers to sharpen it ("Landing a specific song start-to-finish? I can scope that."). Cindy scores the *sharpened* target, never the vibe. Unknown/unfamiliar feats resolve **conservatively** (toward the lower tier) so a scary-sounding made-up goal can't inflate the payout.

**3. Weekly earned-ember ceiling still holds** (`CHALLENGE_REWARD_ALGO.md §Guardrails`, ~300/wk from goals). A big scoped box is prestige + a bounded currency bump, not an ember flood — it doesn't undercut the packs or the Flame Pass's exclusive cosmetics.

---

## Cindy's scoping prompt (drop-in, server firewall intact — Cindy proposes, server computes + grants)

```
You scope the difficulty of a described goal for Philoi. Your user is 18-20, Gen Z,
average starting fitness. You DO NOT grant rewards — you output a tier + rationale;
the server computes and grants the payout. Never state final ember/XP numbers yourself.

STEP 1 — Normalize. Restate the goal as {activity, specific target, timeframe?,
auto_trackable: yes|no}. If it is vague or unmeasurable ("get fit", "be better at X"),
DO NOT score it — ask ONE question to make it specific, or floor it to Uncommon and say so.

STEP 2 — Score. Using the calibration table in DIFFICULTY_SCOPING.md as your anchors,
place the goal on two axes for the MEDIAN 18-20 Gen Z training ~3x/week:
  T = time-to-first-achievement (same day → week → weeks → months → most of a year → year+)
  A = of those who genuinely try, what share ever get it
Read the tier off the grid (Common / Uncommon / Rare / Epic / Legendary / Mythic).
Add ONE sub-step for a fear/pain/hard-technical barrier (never a full tier).
Unknown or unfamiliar feat → resolve to the LOWER plausible tier (conservative).

STEP 3 — Verifiability. auto_trackable (steps, distance, workout volume, grade-via-honor)
→ "auto". Otherwise → "honor" (pays through the Vouched/Unvouched discount; a photo/clip
or friend vouch upgrades it).

STEP 4 — Output JSON only:
{ "restated": "...", "measurable": true|false,
  "difficulty_tier": "epic", "verifiability": "honor",
  "rationale": "Standing backflips take a median beginner 3-9 months and the wall is the
  fear of flipping backward — most people never land one.", "clarifying_question": null }

Ground the rationale in the effort estimate (time + how many ever get it), like the table does.
```

Cindy then shows the human line at creation: **"Cindy scoped this: EPIC — most people never land a backflip. Worth a Vessel of Hestia (proof or a friend's vouch unlocks the full box)."**

---

## What the server does with it (the wiring — see CODE_PROMPT_difficulty_scoping.md)

1. At create, store Cindy's `difficulty_tier` + `verifiability` on the goal/challenge row.
2. `compute_challenge_reward(params, vouch_state)` reads that tier (instead of the `custom → 'easy'` floor) → the tier→box/embers/XP table, then applies duration/scope + the Auto/Vouched/Unvouched discount.
3. Settlement **grants the stored bundle**, not a hard-coded Ignition Crate — so the reveal shows the *scoped* box.
4. The create screen shows the scoped reward **before** the user commits (honest expectation + a great dopamine tease).

---

## Sources
- Couch-to-5K length: [Wikipedia — Couch to 5K](https://en.wikipedia.org/wiki/Couch_to_5K), [Marathon Handbook C25K](https://marathonhandbook.com/couch-to-5k-training-plan/)
- Pull-up prevalence: [Marathon Handbook — how many pull-ups](https://marathonhandbook.com/how-many-pull-ups-should-i-be-able-to-do/), [Biology Insights](https://biologyinsights.com/what-percentage-of-the-population-can-do-a-pull-up/)
- Backflip timeline: [HowLongFor — learn a backflip](https://howlongfor.com/general/learn-to-do-a-backflip), [Quora](https://www.quora.com/How-long-does-it-take-to-learn-how-to-do-a-backflip)
- Handstand timeline: [Playthenics](https://playthenics.com/blog/how-long-to-learn-handstand), [HowLongFor — handstand](https://howlongfor.com/general/train-for-a-handstand)
- Muscle-up timeline: [Gymnasetips — muscle-up progression](https://www.gymnasetips.com/muscle-up-progression/), [HowLongFor — muscle-up](https://howlongfor.com/general/learn-to-do-a-muscle-up)
- Marathon plan length + rarity: [Marathon Handbook — training plans](https://marathonhandbook.com/trainingplans/marathon-training-plans/), [Marathon Handbook — how many have run one](https://marathonhandbook.com/how-many-people-have-run-a-marathon/), [Tufts Now — <1%](https://now.tufts.edu/2022/04/15/less-1-worlds-population-has-run-marathon)
