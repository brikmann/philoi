# Handoff — Agent 1 · LOGIC (migrations 0119–0123)

Branch `agent1-logic`, off `integration-base`. Two commits. `tsc --noEmit` clean, `eslint` clean on
every changed file. **The SQL is unverified against a live database** — see §5.

---

## 1 · Migrations, final numbers

| # | File | What it does |
|---|---|---|
| **0119** | `relics_recatalog_and_discipline_ladders.sql` | The relic feeder: recatalogued evaluator, four discipline ladders as tracked progress, Atlas' Burden, Zeus' Bolt, Crown of Olympus, steps→km, widened trigger |
| **0120** | `session_complete_push_and_relic_copy.sql` | Session-complete self-recap, category map, per-relic push copy, `philoi.suppress_push` guard |
| **0121** | `rank_up_rewards.sql` | Division/tier rank-ups pay embers + a box; trigger renamed for firing order |
| **0122** | `h2h_tie_pays_both.sql` | A genuine H2H draw pays both sides |
| **0123** | `relic_progress_backfill.sql` | One-time backfill so the ladders arrive full, with pushes suppressed |

Plus `supabase/verify_0119_0123.sql` — rollback-wrapped, safe against production:

```
npx supabase db query --linked -f supabase/verify_0119_0123.sql
```

Client: `src/lib/api/relics.ts`, `src/lib/economy/relic-ladders.ts`, `src/lib/step-ladder-sync.ts`
(new) · `catalog.ts`, `rank-up-watcher.tsx`, `auth-context.tsx`, `notification-prefs.ts`,
`types/database.ts` (edited). The `types/database.ts` additions are in a marked appended block;
nothing above it moved.

---

## 2 · Where the drafted prompt was wrong about this schema

`CODE_PROMPT_logic_fixes.md`'s 0119 draft was written against tables that do not exist. Three
assumptions had to be corrected, and they change the shape of the fix:

1. **`check_ins` has no `type` or `value` column.** `'steps'` is a *challenges* type (0035/0115),
   not a check-in type. The draft's "on check_ins insert of type 'steps', set distance_m" trigger
   could never have fired.

   There is no persisted step count anywhere in the system. `syncStepsFromDevice` reads the
   pedometer live and posts a *delta* into `challenge_logs` — and only while a steps challenge is
   running, only inside its window. A user who walks 8 km a day and has never created a steps
   challenge had a lifetime step total of exactly zero. **`user_step_days` + `record_step_days()`
   is the store that was missing**, and `step-ladder-sync.ts` is the client feeder.

2. **The gym tables are `workouts / workout_exercises / workout_sets`** (0037), not `gym_sets`, and
   `workout_sets` has no path to `exercises` of its own — the name lives on `workout_exercises`.

3. **`session_discipline(session_id)` does not exist.** A session's discipline is
   `lock_in_sessions.goal_type` (0012), so it is mapped from that instead.

Two further departures, both to match the **current** `ITEM_CATALOG.md` (which supersedes the
prompt's alternate name list — the doc on `integration-base` is already up to date):

- The ladders are **five named relics on three ladders** (§4a-2), not one relic per rung. Each is
  granted once and its rarity is raised through `cosmetics_owned.rarity_override` — the column 0066
  added, which `collection.tsx` and `use-inventory.ts` already prefer over the catalog value. That
  is what makes "one showcase item that upgrades its tier" render with **no client change**.
- Hours is **per-discipline** — Study, Deep Work and Meditate are three relics on the same 4-rung
  ladder, not one combined Hours ladder.

---

## 3 · Verification results

### H2H ties — verified across all shapes ✅

- **Group ties were already correct.** `finalize_social_challenges` ranks the field with
  `rank() over (...)`, so tied members share a placement; and the reward trigger hands *every*
  finisher the same completion band regardless of placement, so a group tie could not pay
  unequally even if it wanted to. **No change made.**
- **H2H draws were genuinely broken.** The XP award was skipped *and* the whole reward arm sat
  inside `if new.winner_id is not null` — so no box, no embers, no notification, and no
  `reward_payload` for the reveal screen. 0122 fixes both halves.
- The anti-collusion property is kept: a tie pays only when **both** sides put a real number on the
  board. `0 – 0` stays unpaid, so agreeing to do nothing is still not a payout strategy.
- `winner_id` stays NULL on a tie. It records who won, and nobody did; the payout reads scores.

### Forge-Pass ember grant — sound in code, **dormant until 2026-09-10** ⚠️

Traced end to end: `claimPassLevel` → `claim_pass_level` → `economy_move_embers(..., 'forge_pass')`.
The literal is bare, not a `CASE`, so it resolves to the enum cleanly — this is **not** another
instance of the 0114 bug. `pass_claims`' unique index makes it once-only.

But it has never fired, and cannot yet. Read from production today (2026-08-28):

```
season          {"id":"S1","name":"Emberfall","starts_at":"2026-09-10","ends_at":"2026-12-23"}
season_phase()  upcoming
ember_ledger reason='forge_pass'   0 rows, never
pass_claims                        0 rows
pass_xp_ledger                     2 rows
```

`economy_credit_pass_xp_for` returns immediately unless the phase is `live`, and `claim_pass_level`
raises "the season has not started yet". **This is by design, not a misconfiguration** — the season
opens in 13 days. Nothing to fix; the consequence is that **the entire pass economy is untested
code that has never once executed**, so it must be re-verified on 2026-09-10 rather than assumed.

### Also confirmed against production

- `0111–0118` are all applied — Wave 0 landed. ✅
- `pg_cron` job `philoi-finalize-social-challenges` runs `*/10 * * * *`. Settlement **is**
  scheduled; the audit's "is cron even on" concern is closed. ✅
- `check_ins_rank_tracking` and `lock_in_sessions_relics` exist under the names 0121/0119 drop. ✅
- `workout_sets` has no unit column, `profiles.height_cm` does not exist yet. ✅

---

## 4 · Flagged — decisions someone else should make

**🔴 `claim_pass_level` takes the reward list from the client.** `p_rewards` is validated for
*shape* and not for *content*, so a patched build can claim level 1 free with
`[{"kind":"embers","embers":999999}]` and be paid. This is the same class of hole 0090 closed for
boxes ("the client can't aim the roll" was true of which item, false of what was in the bucket).
The fix is the same shape too — a server-side mirror of the pass track, like `box_droppable_items`.
Out of this brief's scope and not silently expanded into; it wants its own task, and it wants one
before the season opens. Agent 2's brief mentions a reward firewall — this belongs with it.

**🟠 Meditate and Deep Work have no goal type.** `GoalType` is
`gym · run · study · job_applications · read · social_media · custom`. So:
- Socrates' Scroll rides `study` + `read` (§4a-2: "reading counts as study") ✅
- Daedalus' Blueprint rides `job_applications` alone — the only focused-making type that exists
- **Oracle's Stillness will sit at zero for everyone** until a `meditate` type ships

`session_discipline()` already maps `'deep_work'` and `'meditate'`, so both ladders light up the day
those types are added, with no migration. Deliberately not fudged by folding meditation into
something else.

**🟠 Prometheus' Shard ships dormant.** §4a needs top-10% **and** a referral, and there is no
referral system anywhere in the codebase. `has_successful_referral()` is a documented stub returning
false, so the relic cannot grant — which is *harder* than 0090 (top 1% alone used to grant it).
Already-owned copies are untouched. Replacing the stub's body is the only change needed.
Recommend building minimal referrals as a standalone task; it also powers growth loops.

**🟠 Gym weight is assumed to be pounds.** `workout_sets` has no unit column and the logger shows
none, so lb is the only convention available — and it is §4a-3's own. Someone logging kg would need
2,205 lb of true load to trip Atlas' Burden, and their Volume ladder reads 2.2× low.

**🟡 The Distance ladder can double-count.** A Strava run whose steps also reached the health store
is counted twice. This is an estimate ladder and both sources under-report in the other direction
(a phone on a desk during a run records neither); de-duping needs per-activity time windows the
step store deliberately does not keep. Tuning question, not a defect.

**🟡 `featuredTrophies` will under-rank an upgraded ladder relic.** It ranks by `getItem().rarity`,
and `get_trophy_hall` does not return `rarity_override`, so a maxed Hercules' Might reads as
uncommon in the featured strip. Not fixed here because it needs a full restatement of
`get_trophy_hall` — a 200-line function other branches may be touching this cycle — for a
mis-ranking that only appears after a rung upgrade. The pieces are ready:
`ladderRarity(relicKey, tier)` in `relic-ladders.ts` resolves the real rarity from the tier that
`get_my_relic_progress()` reports. Two ways to finish it: add `'rarity_override', c.rarity_override`
to the relics jsonb in `get_trophy_hall`, or join `get_my_relic_progress()` on the client.

**🟡 Rank-up reward values are provisional.** 100/300/1200 embers and ignition/furnace/promethean,
per the prompt's table. They live in the `rank_up_rewards` table, so retuning is an `UPDATE`, not a
migration.

**🟡 Not built, and not in this brief:** the Forge-Pass "earn embers" home strip
(`LOGIC_AUDIT §2`), the `/challenge/[id]/reward` reveal screen and its deep-link re-routing, the
Flame-Pass XP rebalance, and the daily/weekly pass-task refresh. All four are client/UI work from
`CODE_PROMPT_logic_fixes.md` that sits outside "migrations + relic/rank/economy libs + push
wiring". Flagged rather than half-done.

---

## 5 · What is NOT verified

**No Docker on this machine, so no `supabase db reset`.** The SQL has been read carefully, its
dollar-quoting and parens balance, and every schema fact it depends on was checked against the
actual migration that created it — but **none of it has been executed.** The prompt's own
instruction to test locally before any prod push still stands.

Deploy order is strictly ascending, `0119 → 0123`, and 0123 must come last: it depends on 0119's
tables and on 0120's push suppression.

---

## 6 · Three things the integrator should know

1. **`0121` renames a trigger, on purpose.** `check_ins_rank_tracking` → `on_check_in_rank_tracking`.
   Postgres fires same-timing row triggers in **name order**, and `on_check_in_insert` is the AFTER
   INSERT that writes `check_ins.xp_earned` — which `universal_score()` sums. The old name sorted
   *before* it, so the rank was always evaluated with the current check-in worth zero. Harmless
   while the only cost was a bookkeeping row a check-in late; not harmless once a box is on the
   line. 0119's new relic trigger is named `on_check_in_relics` for the same reason.

2. **`0122` fully restates `finalize_social_challenges` and `economy_on_social_challenge_closed`.**
   Agent 2's placement/ranked shape (0124–0127) also touches settlement. Integration order puts
   this first, so Agent 2 builds on top — but they should diff against 0122's bodies, not 0112's
   and 0118's.

3. **The evaluator now runs on every check-in insert**, not only on session completion. 0119 opens
   by adding `lock_in_sessions (user_id, status)` — the only existing index there is partial on
   *active* sessions, and every hours branch filters on completed ones, so without it this change
   would turn one sequential scan per lock-in into several per check-in on the hottest write path
   in the app. The hours ladders are also computed in one grouped pass rather than a query per
   discipline, for the same reason.
