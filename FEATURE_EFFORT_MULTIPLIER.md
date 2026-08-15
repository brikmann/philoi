# Feature — Effort multiplier on session XP (ipsative, anti-cheese)

## Concept
XP for a session isn't just time. After a session you log/derive an **effort multiplier** so people who
go harder or more efficiently are rewarded for intensity, not just duration. Two goals:
1. **Anti-cheese:** you can't leave your phone on for 2 hours as a fake "study session" and farm XP.
2. **Fairness (ipsative, self-referenced):** effort is measured against *your own* baseline, not the
   group — so a beginner and an athlete can both earn the intensity bonus for genuinely working hard.

Earned only — never affects anything you can buy, so it's consistent with "XP is never for sale."

## The multiplier by activity type
- **Study / non-physical:** a subjective effort meter at the end (light → hard). Light ≈ **0.75×**,
  medium **1.0×**, hard **1.25×**.
- **Fitness (run/ride/etc.):** blend a subjective RPE meter with objective signals from the wearable —
  **biological effort** (heart rate vs *your* baseline) + **psychological effort** (Strava-style RPE) +
  distance/volume.
- **Gym:** subjective RPE + logged-set **volume** (weight×reps vs your baseline) as the main intensity,
  plus **a small PR bonus** on top — a little multiplier bump when you hit a personal record (for the
  powerlifting / numbers crowd), kept small so rare milestones don't dominate. Native in-session meter.

## Biological effort — make it a RATIO (ipsative)
Noah's example — "140 from 70 and 100 from 50 give the same bio effort" — only holds as a **ratio**:
140/70 = 100/50 = 2.0 (doubling your resting HR). The *deviations* differ (70 vs 50), so use the ratio,
not the difference. Two clean options:
- **HR ratio:** `HR_avg / HR_rest` (simple, needs resting HR from the wearable).
- **% Heart-Rate Reserve (Karvonen):** `(HR_avg − HR_rest) / (HR_max − HR_rest)` — the sports-science
  standard; more accurate but needs HR_max too.
Either way it's self-referenced. Source HR_rest / HR_max from the fitness integrations (Whoop/Garmin/
HealthKit/Health Connect) already scoped.

**Non-wearable path (Strava Premium):** Athlete Intelligence already computes each athlete's personalized
**Zones 1–6** from their activities — no chest strap needed. Pull the zone distribution to get accurate
intensity without a wearable. So the data ladder is: **wearable → %HRR · Strava Pro → Zones 1–6 · neither
→ RPE only.**

## The formula — resolved (training-load / TRIMP model)
**XP scales with duration × intensity — this is what makes "1 hr light ≈ 30 min hard".**

```
sessionXP = baseRate × durationMin × intensityFactor
```
- **Study:** intensityFactor = subjective meter → light 0.75 · medium 1.0 · hard 1.25.
- **Fitness:** intensityFactor from %HRR / Strava zones, blended lightly with the RPE tick. **Distance is
  dropped as a multiplier** (it's what broke the balance) — duration captures "how long," intensity
  captures "how hard." Keep distance only to identify/verify the activity.

**Why "1 hr light = 30 min hard" works:** halving the time means the hard intensity must be ~2× the light
one, so the fitness range spans ~2× (wider than study's 0.75–1.25):

| Zone (~%HRR) | intensityFactor |
|---|---|
| Z1 50–60% | 0.70 |
| Z2 60–70% | 0.85 |
| Z3 70–80% | 1.00 |
| Z4 80–90% | 1.25 |
| Z5 90–100% | 1.50 |
| Z6 sprint | 1.60 |

- 1 hr @ Z1–2 (~0.75): 60 × 0.75 = **45 XP**
- 30 min @ Z5 (1.5): 30 × 1.5 = **45 XP** ✓ equal — your equivalence, exactly.

This is Banister's **TRIMP** (training impulse = duration × HR-intensity weighting) — established sports
science, so it's fair and defensible. Cap the range (~0.6–1.7) so nothing runs away.

## ⚠️ Design flags before this becomes a build
1. **The subjective meter alone doesn't stop cheese** — if "hard" = more XP, everyone taps "hard." It's
   a fairness layer, not the guardrail. Keep the range tight (0.75–1.25) so abuse is capped, and pair it
   with real **active-session detection** for study (app in foreground + periodic interaction / screen
   on, not just "phone running"). That detection is the actual anti-idle guardrail.
2. **Bound every fitness factor.** Cap bio ratio, RPE, and distance contributions individually; a
   multiplicative km-factor is the main way this goes wrong (huge for long slow distance, tiny for short
   intense work).
3. **Gym "PR rank" as bio-effort is fuzzy** — a PR is a milestone, not per-session effort. Per-session
   gym effort really needs logged sets (volume vs your baseline) or worn-HR; reconsider before relying
   on PRs.
4. **Anchor subjective to objective where it exists** — when HR/volume is available, weight the objective
   signal so the subjective slider can't run wild; pure-study is subjective-only (accept it's soft).

## v1 slice — study effort meter (SHIP THIS NOW — Phase 6)
The fitness/gym version is post-v1, but the **study-only slice ships in v1** as the real anti-cheese:
- After a study / non-physical lock-in, a subjective **effort meter** (light / medium / hard →
  0.75 / 1.0 / 1.25×) → `sessionXP = baseTimeXP × meter`.
- Paired with **active-session detection** (the actual guardrail): credit time only while the app is in
  the foreground with periodic interaction / screen on; long idle stretches (no interaction, screen off)
  earn nothing — that's what kills the "leave the phone running" cheese. Pause or reduce credit on idle.
- No wearables, no new integrations → OTA-friendly. Added to Phase 6 of the build pathway (#94).

## Scope — the rest is post-v1
The fitness / gym version depends on the wearable pipeline (#35–38, #45) + native RPE/gym meters + PR
tracking — a meaty build for a post-launch release. Relates: #34, #45, #66 (XP crediting).
