# Code Prompt — collapse lock-in types to a two-tap taxonomy (Study / Fitness)

> 🔴 **SUPERSEDED IN PART — read this before acting on anything below.**
>
> The taxonomy is now **Studying · Deep Work · Fitness** (Fitness → Cardio / Strength). **Deep Work was restored
> on purpose** (Noah, 2026-09-14, post-launch — migration `0186`, commit `3aa2677`, #204) to feed Daedalus'
> Blueprint. **Do NOT remove it.** **Meditate stays killed.**
>
> Everything below that says Deep Work is "killed", to "remove deep_work", "exactly two categories", "bare labels,
> no subtitles", "remap deep_work → study", or that Cindy must only suggest study/fitness is **history, not
> instruction**.
>
> What holds now:
> - **Studying** = studying *for* a course (material and practice problems). **Deep Work** = working *on*
>   something (projects and assignments, for a course or your own). Courses show under **both** (Noah's call),
>   so the tap-1 cards carry a one-line subtitle stating the difference.
> - Deep Work lock-ins write `goal_type = 'custom'` for installed-build crash safety. A real `deep_work` type can
>   replace it only once no pre-#204 builds remain. Legacy `custom`/"Philoi" lock-ins counting as Deep Work is
>   intended.
> - The live presence counter folds Deep Work into the study room, and `study_hours` goals count Study only. Both
>   are intentional.
> - Source of truth: `src/lib/goal-types.ts` (`LOCK_IN_CATEGORY_META` header).

**Product decision (final).** The lock-in type system is too many flat options. Replace it with **two top-level
categories and one sub-choice** — "stupidly simple, two taps". **Build to mock `design-mocks/194-lockin-two-tap.html`.**

```
STUDYING  → second tap: pick a COURSE (KP390, EC120, KP344, KP381, …) or "Custom" (reading, job apps, anything)
FITNESS   → second tap: CARDIO (distance ladder, Strava-auto)  |  STRENGTH (volume ladder, log sets)
```

**Display labels are exactly "Studying" and "Fitness"** (bare, no subtitles — see mock). Internal enum stays
`study` / `fitness`; the fitness sub-activities are `cardio` and `strength`. **"Cardio" not "Running"** — it
covers everything Strava syncs (runs, rides, rows), so the label must be the broad one.

**Killed:** Deep Work and Meditate as selectable types **and** as relic families. Reading / job apps are NOT
their own types — they live under **Studying → Custom**. This is on `integration-wave1`. Client + one additive
migration + a data remap. Do it as a global before the group-chat work.

## 1 · Type model
- Top level enum is exactly **`study`** (label "Studying") and **`fitness`** (label "Fitness"). Second level:
  - `study` → `course_id` (the user's enrolled/custom courses; the existing custom-goal-types feature, task #178,
    becomes the "Custom" option here — a custom course/label).
  - `fitness` → `activity` ∈ { `cardio`, `strength` }.
- Every lock-in resolves to one of **three relic-bearing disciplines**: **Study**, **Cardio** (distance ladder),
  **Strength** (volume ladder). `cardio` = the old Movement/distance family (label "Cardio", not "Running");
  `strength` = the old Gym/volume family. Study ladder unchanged.
- **Remove** `deep_work` and `meditate` everywhere: the type enum/union, the picker, relic-family definitions
  (`relic-ladders.ts`), coach categorization, icons, and any copy. No dead ladder may render in profile.

## 2 · Picker UI (the two taps) — build to mock 194
- Tap 1: **Studying** or **Fitness** (two big cards, bare labels, no subtitle). Tap 2:
  - Studying → course list (enrolled + "＋ Custom") → start.
  - Fitness → **Cardio** / **Strength** → start. (Cardio row carries an "Auto · Strava" pill.)
- Strava-synced activities map to **Fitness → Cardio** automatically (no manual pick). Gym/manual strength →
  **Fitness → Strength**. Keep the existing per-set logging on Strength.

## 3 · Migration + data remap (additive, per-file, no `db push`)
- Next free migration slot. Add/adjust the type columns to the two-tier shape (keep it additive; don't drop the
  old column in the same migration if prod rows still read it — add new, backfill, deprecate later).
- **Remap existing rows:** `deep_work` → `study` (Custom); `meditate` → `study` (Custom) *(or delete if test-only
  — confirm row counts first; there are real pilot users, so prefer remap over delete)*. `gym`/strength-ish →
  `fitness`/`strength`; run/movement → `fitness`/`cardio`.
- Per-file `supabase db query -f` + `migration repair`, reconcile the ledger, commit the migration **with** its
  client half, then `db push` + `git push` as one action (MIGRATIONS.md coupling rule). Dry-run in
  `begin;…rollback;` first.

## 4 · Downstream to fix in the same pass
- **Relics:** `relic-ladders.ts` now has 3 families (Study, Cardio, Strength). Remove the two dropped families
  and any references so profile shows only live ladders.
- **Cindy / coach context (`get_coach_context`, `COACH_TOOLS`):** she must only ever suggest `study`/`fitness`
  (+ the sub-choice). Remove deep_work/meditate from her vocabulary and any prompt text — otherwise she'll
  recommend a type that no longer exists.
- **Icons / activity icon set (#140):** map to the 3 disciplines; drop the two dead glyphs.
- **Challenges & campfire goals:** goal creation uses the same two-tap taxonomy; a "grade challenge" is a Study →
  course goal. Verify challenge creation still resolves a valid discipline for reward payout.

## Done (device-verified)
Creating a lock-in is two taps (Study→course/Custom, or Fitness→Running/Strength); Deep Work and Meditate are
gone from the picker, relics, icons, and Cindy; existing deep_work/meditate rows remapped (no orphaned data,
profile shows only the 3 live ladders); Strava runs land as Fitness→Running; strength keeps per-set logging.
`tsc` green, migration applied + ledger reconciled. Ref: `relic-ladders.ts`, the lock-in type picker, the
custom-goal-types work (#178), `get_coach_context`, MIGRATIONS.md.
