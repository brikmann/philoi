# App bug ledger — full sweep

Branch: `fix/app-sweep` (worktree, branched from `add-marketing-site` @ `07fcb40`). **Not merged.**
`npx tsc --noEmit` is clean on this branch.

Tick the `[ ]` on each entry you want, then hand it to `AGENT_PROMPT_apply_sweep_fixes.md`.

> **Why a worktree.** Three agents were writing to the main working tree at once (this sweep, the
> campfire agent, the flame agent) and another session held `.git/claude-writer.lease`. Working in
> `.claude/worktrees/bugfix-sweep` off `07fcb40` is what makes these diffs reviewable in isolation —
> nothing here has touched the shared tree or the ship branch.

> **Nothing was deployed.** Every SQL finding below was reproduced and every fix verified against the
> **linked project** inside `begin; … rollback;`, then re-checked to confirm production was unchanged.
> No `db push`, no `functions deploy`. See **Deploy-gated** at the bottom.

---

## Fixed

### 1. `[x] approve` — 🔴 `grant_reward` has never paid out, for anyone, ever

> **DONE** — approved, deployed, verified. `0114` in aa48dca (merge of `fix/app-sweep`).

**Repro.** Against the linked project:
```sql
select grant_reward(<any user>, 'friend_h2h', 1.0, 7, 1, 0.0, true, null);
-- ERROR: 42883: function economy_move_embers(uuid, integer, text, uuid) does not exist
```

**Root cause.** `economy_move_embers`' third parameter is `ember_reason`, an **enum**. `grant_reward`
passes it a `CASE`:

```sql
case when p_type = 'season' then 'season_reward' else 'challenge_win' end
```

A bare literal would arrive as `unknown` and resolve to the enum — which is why the `not p_verified`
early-return a dozen lines above still works. A `CASE` whose branches are all `unknown` resolves to
**`text`**, and there is no implicit text→enum cast. plpgsql resolves the call the first time the line
is *reached*, so the migration deployed clean and only broke when somebody actually earned something.

Three lines further down the `loot_boxes` insert does the identical thing to `obtained_via`
(`box_obtained_via`). That one was invisible behind the first — the function raised before it ever got
there. **Both** needed casting; fixing only the reported error just moves the failure down three lines.

The defect predates 0083: **0064 wrote the line, 0066 restated it, 0083 recalibrated around it.**
Every live caller passes `p_verified => true`, so the working branch is dead code.

**Blast radius** — all three raise today:
| Caller | What breaks |
|---|---|
| `economy_on_challenge_completed` | AFTER UPDATE trigger on `challenges`. Completing a personal goal **throws**, and because the trigger runs inside the same statement it takes `log_challenge_progress` down with it — the user's last log before hitting target is the one that errors. |
| `economy_on_social_challenge_closed` | Winner/loser payout on a settled challenge. |
| `close_season_scope` | Season placement rewards. |

**The ledger corroborates it.** Every other ember reason has rows; the two this function writes have none:

| reason | n | last |
|---|---|---|
| shop_spend | 424 | 2026-08-20 |
| salvage | 304 | 2026-08-20 |
| flame_meter | 19 | 2026-08-23 |
| lock_in | 4 | 2026-08-22 |
| iap | 2 | 2026-08-16 |
| **challenge_win** | **0** | never |
| **season_reward** | **0** | never |

`goal_daily` / `goal_streak` are empty one step downstream: the client only calls
`economy_award_goal_day` when `log_challenge_progress` reports `just_completed`, and that RPC is what raises.

**Fix.** `supabase/migrations/0114_grant_reward_ember_reason_cast.sql` — 0083's body restated verbatim
with `::ember_reason` and `::box_obtained_via` added. Signature identical, so `create or replace` is
correct and no overload is created. *(Deliberately not solved with an
`economy_move_embers(uuid,int,text,uuid)` overload — a text overload beside the enum one would make every
bare-literal call site ambiguous and break the paths that currently work.)*

**Verification.** Rolled-back transaction, before and after. Before: `42883`. After:
`challenge_win` → 20 embers + an `ignition` box, wallet delta 20; `season` → 200 embers + `hephaestus`
+ badge `season-elite-S1`. Re-runnable via `supabase/verify_0113_0114.sql`.

---

### 2. `[x] approve` — 🔴 Migration 0036 is recorded as applied but never ran

> **DONE** — approved, deployed, verified. `0115` in aa48dca.

**Repro.** Sleep / Workout minutes / Strain are offered in the goal picker
([create.tsx:428-430](src/app/challenge/create.tsx#L428-L430)). Creating any of them fails:
```
new row for relation "challenges" violates check constraint "challenges_type_check"
```
Confirmed by inserting each type against the linked project — all three rejected, `steps` accepted.

**Root cause.** `supabase migration list --linked` shows 0036 with a matching remote entry, so `db push`
skips it and always will. None of it is on the database:

```
to_regclass('public.whoop_connections')  -> null
pg_proc where proname like '%whoop%'     -> 0 rows
challenges_type_check                    -> still 0035's list, ending at 'ride_distance'
```

**How it was found.** Extracted all **143** `supabase.rpc()` names the client and edge functions call and
diffed against `pg_proc`. Exactly two had no deployed function: `get_my_whoop_connection_status` and
`disconnect_my_whoop` — both 0036's. A follow-up sweep of every other migration's headline object
(`challenge_participants` 0096, `challenge_periods` 0072, `goal_day_awards` 0083, `milestones` 0093,
`notification_events` 0086, `equipped_loadout` 0070, `google_calendar_connections` 0105,
`profiles.timezone` 0084, `profiles.bio` 0091, `challenge_cheers.note` 0110, `coach_usage` 0101) found
all of them present. **One bad `schema_migrations` row, not a systemic problem.**

Secondary effects: `get_my_whoop_connection_status` sits behind a `try/catch` returning false
([fitness-challenge-sync.ts](src/lib/api/fitness-challenge-sync.ts)), so a sleep goal silently falls back
to the phone's health store; `disconnect_my_whoop` has no guard and raises.

**Fix.** `supabase/migrations/0115_reapply_0036_whoop_integration.sql` — 0036's contents re-applied
idempotently. Written as a new forward-only migration rather than
`supabase migration repair --status reverted 0036` + re-push: repair rewrites history to claim something
that did not happen, and the repo's rule is that an applied migration is never edited or re-run.

**Verification.** Rolled-back transaction: all three metrics insert, a bogus type is still rejected (the
constraint is still doing its job), `whoop_connections` exists, and both RPCs resolve and return.

---

### 3. `[x] approve` — Time-counted custom goals: 60× wrong unit, and credit that never retries

> **DONE** — approved, deployed, verified. `0113` in aa48dca; the drip it feeds landed with #7 (`0116`, 87e85d1).

**Repro.** Create a custom goal, mode "Lock-in time", target `10` (the UI labels it **hours**). Do a
45-minute lock-in named the same thing. The card reads **`45 / 10 hours`** and the goal completes.

**Root cause — two defects.**
1. **Wrong unit, by 60×.** The create screen forces `unit = 'hours'` and says so out loud, so the target
   is hours. `credit_lockin_time_goals` credited `duration_seconds / 60.0` — **minutes**. Confirmed on the
   live function: `position('duration_seconds / 60.0' in prosrc) = 597`, no `3600` anywhere.
2. **Client-only, once, unawaited.** 0061's own header promises the credit fires after a lock-in *"and
   again on the Challenges tab, so a backgrounded app can't silently lose the credit."* **That second call
   was never written** — one caller in the app ([lock-in/index.tsx:459](src/app/lock-in/index.tsx#L459)),
   fire-and-forget (`.catch(() => {})`), several awaits deep in the stop path. There is also **no trigger
   on `check_ins`** doing it (live triggers: `check_ins_rank_tracking`, `on_check_in_insert`,
   `on_check_in_insert_snapshot_circles`, `on_check_in_notify` — that's all). Background the app on the
   done screen and the minutes are gone for good.

**Fix.** `supabase/migrations/0113_lockin_time_goal_credit_repair.sql` — work moves into
`credit_lockin_time_goals_for(check_ins)`, keyed off the row's `user_id` so a trigger can call it; an
AFTER INSERT trigger on `check_ins` runs it in the same transaction that creates the check-in
(`stop_lock_in_session` writes `goal_detail` and `duration_seconds` in that same insert, so AFTER INSERT
already sees both). The RPC keeps its name, signature and ownership check, so the shipped client still
resolves and becomes a no-op retry.

**No backfill needed:** `count_mode = 'lockin_time'` has **0 rows** on the linked project.

**Verification.** Rolled-back transaction: a 90-minute lock-in credits **1.50** (not 90), the name match
is case-insensitive, a second call for the same check-in credits **0**, crossing the target sets
`completed_at`, and no other user's goal is touched.

---

### 4. `[x] approve` — Daily step/sleep goals read the wrong window

> **DONE** — approved. `periodStartInstant()` in aa48dca.

**Repro.** A daily steps goal counts steps that are not from today. West of Greenwich the count starts
high in the morning; east of it, everything walked before mid-morning never appears.

**Root cause.** `challenges.period_start` is a Postgres **`date`** — a bare `2026-08-23` with no zone —
and `new Date('2026-08-23')` parses to **UTC** midnight. Correct for weekly (`week_start()` is
deliberately Sunday 00:00 UTC — [week.ts](src/lib/time/week.ts), 0071); **wrong for daily**, which
[0084](supabase/migrations/0084_local_midnight_goal_reset.sql) rolls at the owner's **local** midnight.
So the health-store window was `[UTC midnight, now]`:

- **UTC-4 (Toronto):** window opens 20:00 the previous *local* evening → yesterday's steps land in today.
  Verified on this machine: `new Date('2026-08-23')` → `Sat Aug 22 2026 20:00:00 GMT-0400`.
- **UTC+9 (Tokyo):** window opens 09:00 local → everything before then is never counted, and never can
  be, since the window only moves forward.

Weekly hid it: the same offset falls in the small hours of Sunday, where there are almost no steps to
misplace and a week's total swamps them.

**Fix.** [src/lib/api/fitness-challenge-sync.ts](src/lib/api/fitness-challenge-sync.ts) — a
`periodStartInstant()` helper returning local midnight for `period === 'day'` and the unchanged UTC parse
otherwise. It feeds **both** the health-store window and the `challenge_logs` delta filter, so the two
stay the same window on either branch. Applied to steps and sleep.

**Verification.** Parse comparison run in the local zone (UTC-4): old → `Aug 22 20:00`, new →
`Aug 23 00:00`. The UTC+9 case is the same arithmetic in the other direction (`TZ` is not honoured by
Node on Windows, so that half is reasoned, not executed).

---

## Found, not fixed — needs an asset or a product call

### 5. `[x] approve` — Equipped-audio silence: the one Audio item every user owns has no file

> **DONE** — approved. Asset sourced and wired: 1a31e7b. `sfx-emberfall-strike` still has no file and is now listed in `AUDIO_TO_SOURCE.md`. **Needs a native rebuild** (bundles a new asset).

`audio-base-hearth-hum` is the free starter Audio environment — every account owns it
(`seed_default_loadout`, 0073) and can equip it in one tap. **There is no audio file for it**: it is
absent from `AMBIENT_SOURCES` in [src/lib/sound.ts](src/lib/sound.ts), absent from
`assets/audio/cosmetic/` (6 `audio-*.mp3` files, none of them hearth-hum), and absent from
`assets/audio/cosmetic/preview/`. So equipping it produces **silence, with no explanation** — and it is
by far the most likely Audio item to be equipped, since the other six are box-pool cosmetics.

`sfx-emberfall-strike` (Forge Pass S1 mythic) has the same gap in the reward-sound map.

The code is not wrong — `hasAmbientLoop` / `hasRewardSound` correctly no-op rather than throw, and
`PreviewButton` correctly renders nothing. **This needs the asset**, and I did not want to paper over it
by pointing hearth-hum at a premium box item's loop, which would hand out a paid cosmetic's audio for free.

*Note:* `DEFAULT_LOADOUT` deliberately leaves the `audio` slot **empty** ("equipping one by default would
play a loop into a room the user never agreed to make noise in"), so this is not silence-on-signup — it
bites the moment someone equips it.

### 6. `[x] approve` — A lock-in has no way to name a time-counted goal reliably

> **DONE** — approved. Chips on the detail field: 2173400.

`credit_lockin_time_goals` matches `lower(trim(label)) = lower(trim(goal_detail))`. But `goal_detail`
comes from a **free-text `TextInput`** in [lockin-goal-picker.tsx](src/components/lockin-goal-picker.tsx),
and nothing in that sheet surfaces the user's time-counted goals. You have to type the goal's name
character-for-character, with no hint that this is what makes it count. Fix #3 makes the credit *land*;
this is why it would rarely be *triggered*. The obvious fix — offer the user's `lockin_time` goals as
tappable chips on that field, guaranteeing an exact match — is a UI change, so it is your call rather
than mine under "don't add features".

### 7. `[x] approve` — Goal-day award never fires for a lock-in-credited goal

> **DONE** — approved, deployed, verified. `0116` + `0117` in 87e85d1. **Two premises in this entry were wrong** — see the commit message and `CHALLENGE_REWARD_ALGO.md` §drip: `custom` never scored *ambitious* (0085 guards the `{0,0}` sentinel with `> 0`, so it has always paid the `easy` floor), and the client-side mechanism the decision doc proposed cannot work now that `0113` credits from a trigger. The award moved server-side instead.

`logChallengeProgress` calls `awardGoalDay` when the server reports `just_completed`
([challenges.ts:71](src/lib/api/challenges.ts#L71)). `creditLockInTimeGoals` returns a bare count, so a
time-counted goal completed by a lock-in never pays the goal-day drip that the same goal completed by a
hand-logged entry does. I did **not** change this: `economy_config.goal_difficulty` has
`"custom": {"moderate": 0, "ambitious": 0}`, so every custom goal scores as *ambitious* and would take the
top drip — an economy-balance decision, not a bug fix. Worth a look once #1 is deployed and the award
path can actually run.

---

## Could not repro on HEAD

| Tracker item | Finding |
|---|---|
| 🔴 Gym lock-in → purple splash freeze | **Already fixed.** [lock-in/index.tsx:225-283](src/app/lock-in/index.tsx#L225-L283) carries the screen-lifetime `screenMountedRef` (replacing the per-effect-run `mounted` flag), reads `activeSession` through a ref instead of the dep array, and adds a 12s `startStalled` escape hatch with a "Back to Philoi" bail-out — the modal has no back button. The gym `start_workout` effect has the same treatment. |
| 🔴 ×10 loot-box vault crash at results | **Already hardened.** [shop/open.tsx](src/app/shop/open.tsx) wraps the flow in an `ErrorBoundary` that exits to `/inventory`, opens boxes sequentially and reveals partial hauls rather than throwing away a ×10 that died on box 4, and `MultiMenu` renders an explicit cell for an item this build's catalog doesn't know instead of dropping it. `BOXES[...]?.odds[...]` is optional-chained on both paths. |
| 🔴 Box opens throw "expected JSON array" | **Fixed by deployment.** 0069 *is* applied, and `open_loot_box(uuid,jsonb)` is the only overload in `pg_proc` — the `text[]` one is gone, so there is no shape for PostgREST to mis-coerce. The drop pool is populated at every rarity (common 4, uncommon 7, rare 15, epic 19, legendary 14, mythic 5 — 64 total), so the `Empty drop pool` raise is unreachable too. |
| Buy Direct weekly rotation + countdown | **Already implemented** (punchlist 8 §2/§5). Rotation is derived from the shared `weekIndex()` at module scope, off the *full* catalog pool so buying doesn't re-deal mid-week; `rotatesInLabel` ticks every 30s. Also checked the stride for collisions: pool 64, stride 7, `gcd = 1` → no duplicate slots in any week. |
| Purchase toast + inventory refetch | **Already implemented** (punchlist 8 §3). [shop/item/[itemId].tsx](src/app/shop/item/[itemId].tsx) awaits `refetch()` *before* opening the `PurchaseSheet`, and `useInventory` refetches on focus so the shop's own copy updates on the way back. |
| Flare intensity + scope | **Matches FLARES_SPEC.** `EquippedFlarePerimeter` is mounted in **both** lock-in branches (gym at :818, base at :940), and the flame dims under a flare (`dimmed={flareEquipped}`); the gym branch's hard-coded `dimmed` is §23's own rule, not a bug. |

## Also checked, clean

- **56 routes** — every literal `router.push/replace/navigate` target resolves. (`/(tabs)/challenges` in
  `_layout.tsx:156` is fine; expo-router accepts explicit group segments.)
- **64 asset `require()`s** — all resolve on disk.
- **143 client RPCs** — all present in `pg_proc` except the two in #2.
- **Enum-`CASE` bug class** — swept every migration for the #1 pattern feeding `ember_reason`,
  `box_obtained_via` or `item_source`. The only hits are the three successive `grant_reward` bodies
  (0064 → 0066 → 0083), all superseded by the one 0114 fixes. No other function has it.

## Lint baseline (unchanged by this branch)

25 errors / 7 warnings, all pre-existing: 19 × `react-hooks/set-state-in-effect`, 2 × "Cannot call impure
function during render", 2 × "Cannot access refs during render", 2 × `react/no-unescaped-entities`, plus 6
× `no-require-imports` (deliberate lazy native loads) and 1 unused `Spacing` import in
`privacy-selector.tsx`. Left alone per the brief.

---

## For the campfire agent (logged, not touched)

- **Challenges not resetting / completed challenges not clickable / no history** — inside the scope
  boundary, and `0112_challenge_loop_repair.sql` already covers this ground. Not investigated.
- ⚠️ **Cross-dependency: entry #1 blocks them.** `economy_on_social_challenge_closed` calls
  `grant_reward`, so **every settlement payout raises today**. Any tie/winner-award behaviour they test
  before `0114` is deployed will look broken for a reason that has nothing to do with their branch.
  Worth telling them.
- **Migration numbering:** they hold `0112`. This branch takes `0113`, `0114`, `0115`.

---

## New migrations (forward-only)

| File | What |
|---|---|
| `0113_lockin_time_goal_credit_repair.sql` | Hours not minutes; credit moves onto an AFTER INSERT trigger on `check_ins`. |
| `0114_grant_reward_ember_reason_cast.sql` | `::ember_reason` + `::box_obtained_via`. **Deploy this first.** |
| `0115_reapply_0036_whoop_integration.sql` | Re-applies 0036 idempotently. |

Plus `supabase/verify_0113_0114.sql` — a rolled-back before/after check, safe to run against production.

## Deploy-gated — DONE

All of it was run on 2026-08-23/24 against the linked project and verified. `0113`–`0117` are applied;
`verify_0113_0114.sql` reproduced `42883` before the push and printed its full expected table after,
`verify_0116.sql` printed its own. `0115` was checked separately (table, both RPCs, constraint arm).
Migration `0118` belongs to the campfire pass, not this one.

**Still outstanding: a native rebuild for #5**, which bundles a new audio asset. Nothing else here
needs one, and no edge function changed.

### The original steps, for the record


1. **`npx supabase db push`** — applies 0113, 0114, 0115. Nothing here was pushed.
   - Order matters only in that **0114 should land first**; 0113's completion path calls into it.
   - 0115 is idempotent and touches no data.
2. **`npx supabase db query --linked -f supabase/verify_0113_0114.sql`** — run **before** the push (it
   should stop at `42883`, which is the repro) and **after** (it should print the expected table in the
   file's header). Safe either way: it ends in `ROLLBACK`.
3. **No `functions deploy` needed** — no edge function changed.
4. **No native rebuild needed** for anything in "Fixed". Entry #5 *would* need one, since a new audio
   asset is bundled.
5. **After deploying**, spot-check that `challenge_win` / `season_reward` start appearing in
   `ember_ledger` — they never have.
