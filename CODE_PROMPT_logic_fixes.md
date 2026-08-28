# Code Prompt — Background Logic Fixes (0119, 0120 + home strip)
_Gated by Noah. Decisions locked: stride = height-based (0.42×height, 0.75 m fallback); session-complete push fires on EVERY completed session._

Companion to `LOGIC_AUDIT_2026-08.md`. Apply in order. **Test locally with `supabase db reset` before any prod push** — this is unverified SQL against the live schema; two spots are marked `CONFIRM`.

---

## Migration `0119_relics_recatalog_and_discipline_ladders.sql`

Rewrites `economy_evaluate_relics()` to the current catalog and adds discipline ladders, Atlas, steps→km, and a wider trigger. Replaces the stale 0090 body.

### Verified schema facts (from audit)
- Rank tier via `rank_tier_for_score(universal_score(p_user)).tier`. Ladder order: `bronze silver gold platinum diamond hero titan olympian immortal primordial`. **hero** = array_position ≥ 6; **primordial** = tier = `'primordial'`.
- Hours (all): `sum(extract(epoch from (last_confirmed_at - started_at))/3600) from lock_in_sessions where status='completed'`.
- Season percentile: `season_standings (user_id, rank, board_size)`, frozen at close. `rank/board_size <= 0.10` = top 10%.
- Gym volume: `workout_sets` → `workout_exercises` → `workouts.user_id`; `coalesce(weight,0)*reps`. Exercise names in `exercises.name`; big-3 match by name ILIKE (`%bench press%`, `%squat%`, `%deadlift%`).
- Distance: `check_ins.distance_m` (populated by Strava; steps→km added below).

```sql
-- 0119 — relics recatalogued to ITEM_CATALOG + discipline ladders + steps→km.
-- Supersedes the 0090 relic set (Hestia retired; Icarus/Prometheus/Athena redefined) and adds
-- Atlas, Zeus' Bolt, and the three discipline ladders. economy_grant_relic() (0090) is reused.

-- 1 ── height for stride (nullable; collect in onboarding/profile later; 0.75 m fallback until then)
alter table profiles add column if not exists height_cm numeric check (height_cm > 0 and height_cm < 260);

create or replace function stride_m_for(p_user uuid)
returns numeric language sql stable as $$
  select coalesce((select height_cm/100.0*0.42 from profiles where id = p_user), 0.75);
$$;

-- 2 ── steps → distance_m estimate on fitness check-ins that carry no GPS distance
create or replace function checkins_estimate_distance()
returns trigger language plpgsql as $$
begin
  if new.distance_m is null and new.type = 'steps' and coalesce(new.value,0) > 0 then
    new.distance_m := new.value * stride_m_for(new.user_id);
  end if;
  return new;
end; $$;
-- CONFIRM: the steps column on check_ins is `value` (0035 used typed check_ins). Adjust if named otherwise.
drop trigger if exists check_ins_estimate_distance on check_ins;
create trigger check_ins_estimate_distance
  before insert on check_ins for each row execute function checkins_estimate_distance();

-- 3 ── the recatalogued evaluator
create or replace function economy_evaluate_relics(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_granted int := 0; v_hours numeric; v_tier text; v_pos int;
  v_weeks int; v_top10 boolean;
  v_volume numeric; v_km numeric; v_disc_hours numeric;
  v_bench numeric; v_squat numeric; v_dead numeric; v_big3 numeric;
begin
  if p_user is null then return 0; end if;

  -- ANVIL OF HEPHAESTUS — 500 cumulative hours (unchanged, all completed sessions).
  select coalesce(sum(extract(epoch from (last_confirmed_at - started_at))/3600.0),0) into v_hours
    from lock_in_sessions where user_id = p_user and status='completed';
  if v_hours >= 500 then
    if economy_grant_relic(p_user,'relic-anvil-of-hephaestus','legendary',
      'Total consistency — 500 hours forged.') then v_granted := v_granted+1; end if;
  end if;

  -- ICARUS' FEATHER — reach Hero. (Flew close to the sun and ascended past what was possible.)
  select t.tier into v_tier from rank_tier_for_score(universal_score(p_user)) t limit 1;
  v_pos := array_position(array['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial'], v_tier);
  if coalesce(v_pos,0) >= 6 then
    if economy_grant_relic(p_user,'relic-icarus-feather','legendary',
      'Reached Hero. Zeus admires his effort.') then v_granted := v_granted+1; end if;
  end if;

  -- ZEUS' BOLT — reach Primordial. (The king himself bows toward your greatness.)
  if v_tier = 'primordial' then
    if economy_grant_relic(p_user,'relic-zeus-bolt','mythic',
      'Reached Primordial. The king himself bows.') then v_granted := v_granted+1; end if;
  end if;

  -- ATHENA'S AEGIS — 6 CONSECUTIVE ISO weeks each with >=1 completed session (was: full calendar month).
  with wk as (
    select distinct date_trunc('week', started_at)::date d
    from lock_in_sessions where user_id=p_user and status='completed'
  ), streak as (
    select d, d - (row_number() over (order by d) * interval '1 week') grp from wk
  )
  select coalesce(max(cnt),0) into v_weeks from (
    select count(*) cnt from streak group by grp
  ) s;
  if v_weeks >= 6 then
    if economy_grant_relic(p_user,'relic-athenas-aegis','epic',
      'Six weeks unbroken. Athena guards the disciplined.') then v_granted := v_granted+1; end if;
  end if;

  -- PROMETHEUS' SHARD — top 10% season finish AND a successful referral.
  -- ⚠️ BLOCKED: no referral system exists (see prompt §Referral blocker). Ships gated behind the
  -- referral clause so it CANNOT grant until referrals land — top-10% alone must not unlock it.
  select exists(select 1 from season_standings s
    where s.user_id=p_user and s.rank::numeric/greatest(s.board_size,1) <= 0.10) into v_top10;
  if v_top10 and has_successful_referral(p_user) then   -- CONFIRM: implement has_successful_referral (see §Referral)
    if economy_grant_relic(p_user,'relic-prometheus-shard','mythic',
      'Stole fire and shared it — top 10% and brought another to the flame.') then v_granted := v_granted+1; end if;
  end if;

  -- ATLAS' BURDEN — 1000 lb club: best bench + best squat + best deadlift (top working set each).
  select coalesce(max(coalesce(ws.weight,0)),0) into v_bench
    from workout_sets ws join workout_exercises we on we.id=ws.workout_exercise_id
    join workouts w on w.id=ws.workout_id join exercises e on e.id=we.exercise_id
    where w.user_id=p_user and e.name ilike '%bench press%';
  select coalesce(max(coalesce(ws.weight,0)),0) into v_squat
    from workout_sets ws join workout_exercises we on we.id=ws.workout_exercise_id
    join workouts w on w.id=ws.workout_id join exercises e on e.id=we.exercise_id
    where w.user_id=p_user and (e.name ilike '%squat%' and e.name not ilike '%split%');
  select coalesce(max(coalesce(ws.weight,0)),0) into v_dead
    from workout_sets ws join workout_exercises we on we.id=ws.workout_exercise_id
    join workouts w on w.id=ws.workout_id join exercises e on e.id=we.exercise_id
    where w.user_id=p_user and e.name ilike '%deadlift%';
  v_big3 := v_bench + v_squat + v_dead;
  if v_big3 >= 1000 then
    if economy_grant_relic(p_user,'relic-atlas-burden','mythic',
      'A thousand pounds across the three great lifts. Atlas nods in approval.') then v_granted := v_granted+1; end if;
  end if;

  -- DISCIPLINE LADDER · VOLUME (lbs): 10k/25k/50k/100k/250k = U/R/E/L/M
  select coalesce(sum(coalesce(ws.weight,0)*ws.reps),0) into v_volume
    from workout_sets ws join workouts w on w.id=ws.workout_id where w.user_id=p_user;
  perform grant_ladder(p_user,'volume',v_volume, array[10000,25000,50000,100000,250000],
    array['uncommon','rare','epic','legendary','mythic']);

  -- DISCIPLINE LADDER · DISTANCE (km): 50/100/250/414 = R/E/L/M
  select coalesce(sum(distance_m),0)/1000.0 into v_km from check_ins where user_id=p_user;
  perform grant_ladder(p_user,'distance',v_km, array[50,100,250,414],
    array['rare','epic','legendary','mythic']);

  -- DISCIPLINE LADDER · HOURS (Study·Deep Work·Meditate): 10/25/50/100 = U/R/E/L
  -- CONFIRM: how a session's discipline is typed (via linked goal.type, or a session kind column).
  select coalesce(sum(extract(epoch from (last_confirmed_at-started_at))/3600.0),0) into v_disc_hours
    from lock_in_sessions s where s.user_id=p_user and s.status='completed'
    and session_discipline(s.id) in ('study','deep_work','meditate');
  perform grant_ladder(p_user,'hours',v_disc_hours, array[10,25,50,100],
    array['uncommon','rare','epic','legendary']);

  return v_granted;
end; $$;

-- ladder helper: grant every rung crossed, idempotently (α..Ω keys per rarity)
create or replace function grant_ladder(p_user uuid, p_family text, p_value numeric,
  p_thresholds numeric[], p_rarities text[])
returns void language plpgsql security definer set search_path=public as $$
declare i int; v_greek text[] := array['alpha','beta','gamma','delta','omega'];
begin
  for i in 1..array_length(p_thresholds,1) loop
    if p_value >= p_thresholds[i] then
      perform economy_grant_relic(p_user,
        format('relic-%s-%s', p_family, v_greek[i]), p_rarities[i],
        format('%s ladder — tier %s reached.', initcap(p_family), v_greek[i]));
    end if;
  end loop;
end; $$;

-- 4 ── widen the trigger: re-evaluate on fitness check-ins too, not just lock-in status changes.
create or replace function economy_on_checkin_check_relics()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform economy_evaluate_relics(new.user_id); return new; end; $$;
drop trigger if exists check_ins_relics on check_ins;
create trigger check_ins_relics after insert on check_ins
  for each row execute function economy_on_checkin_check_relics();
```

**Also do:** retire the Hestia grant path (leave already-owned copies; just stop granting) and confirm the relic keys above match `ITEM_CATALOG.md` §4a exactly.

---

## Migration `0120_session_complete_push_and_relic_copy.sql`

```sql
-- 0120 — Strava-style self-recap on every completed session + custom per-relic push copy.

-- A) session-complete recap to the OWNER. notify_event suppresses self-notify when actor=recipient,
-- so pass actor_id = NULL to allow a self-recap.
create or replace function notify_session_complete()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_min int; v_type text;
begin
  if new.status='completed' and (old.status is distinct from 'completed') then
    v_min := round(extract(epoch from (new.last_confirmed_at - new.started_at))/60.0);
    perform notify_event(
      array[new.user_id], 'session_complete',
      format('🔥 Locked in for %s min', v_min),
      'Nice work — your streak lives another day.',
      null, new.id, '/(tabs)', '{}'::jsonb, null, 'flame',
      jsonb_build_object('minutes', v_min));
  end if;
  return new;
end; $$;
drop trigger if exists lock_in_sessions_complete_push on lock_in_sessions;
create trigger lock_in_sessions_complete_push
  after update of status on lock_in_sessions for each row execute function notify_session_complete();

-- map the new type to a category so the settings toggle governs it
-- (extend notification_category(): add 'session_complete' -> 'streak_reminders').
-- Redefine the function including the new type; keep all existing mappings.

-- B) custom relic copy: economy_grant_relic already passes p_why as the push body and now carries
-- a flavor line per relic (see 0119 grant calls). Upgrade the TITLE from generic 'Relic earned' to
-- the relic's display name. Add a small key->name lookup or store name on the cosmetic and read it.
```

Update `notification_category()` to add `'session_complete' -> 'streak_reminders'` (copy the current body from 0112 and add the one line).

---

## Client — Forge Pass "Earn embers" strip on home
`src/app/(tabs)/index.tsx` + new `src/components/home/forge-pass-strip.tsx`

A compact strip (above or below the campfire valley — mock placement first) showing 3–4 live rows of what earns embers/XP today, each with progress + reward chip, tapping through to the Forge Pass. Read from the season/level-claim tables (`0074`); no new economy math. Rows e.g.: "Lock in 60 min → +X✦ · 34/60", "Complete a challenge → rare box", "Hit your daily fire → +X✦".

---

## Migration `0121_rank_up_rewards.sql` — embers + box on every division/tier rank-up

**Ask:** division rank-ups AND tier rank-ups pay embers + a box. **Hook:** `economy_track_rank_change()` (0066) already fires on check-in, records a confirmed ordinal rank-up in `rank_up_events`, and credits pass-XP — it just doesn't pay embers/boxes. Add that, and emit the `ranked_up` bell event (with reward payload for the reveal, mock 131).

**Verified primitives:** `economy_move_embers(user, delta, reason::ember_reason, ref)` credits the wallet; `insert into loot_boxes (user_id, box_key, obtained_via, provenance)` grants a box. Box tiers low→apex: `ignition · furnace · hestia · hephaestus · promethean`.

**Enum note (important):** to avoid the "unsafe use of new enum value in same transaction" error, this reuses existing enum values — `ember_reason = 'season_reward'` and `box_obtained_via = 'forge_pass'` (both fit: rank is season/pass progression). No `ALTER TYPE`. If you'd rather have a distinct `'rank_up'` reason for ledger clarity, add it in a **separate earlier migration** and swap the casts.

**Reward tiers (tunable):**
| Event | Embers | Box |
|---|---|---|
| Division up (same tier, e.g. Silver III→II) | 100 | `ignition` |
| Tier up (new tier, e.g. Silver→Gold) | 300 | `furnace` |
| Reach Primordial (apex, no divisions) | 1200 | `promethean` |

A single check-in can jump multiple ranks; this pays **once per rank-up event**, and if a tier boundary was crossed it pays the tier reward (Primordial takes precedence).

```sql
-- 0121 — division/tier rank-ups pay embers + a box, and land in the bell with a reveal payload.
-- Full redefinition of 0066's economy_track_rank_change(): unchanged detection + pass-XP, plus rewards.

create or replace function economy_track_rank_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_score numeric; v_index int; v_prev int;
  v_from record; v_to record;
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_embers int; v_box text; v_kind text; v_label text; v_div text;
begin
  v_score := universal_score(new.user_id);
  v_index := rank_index_for_score(v_score);
  if v_index is null then return new; end if;

  select rank_index into v_prev from user_rank_state where user_id = new.user_id;
  insert into user_rank_state (user_id, rank_index) values (new.user_id, v_index)
  on conflict (user_id) do update set rank_index = greatest(user_rank_state.rank_index, excluded.rank_index),
                                      updated_at = now();

  -- First sighting = baseline only; a dip never pays.
  if v_prev is null or v_index <= v_prev then return new; end if;

  select tier, division into v_to   from rank_thresholds where rank_index = v_index;
  select tier, division into v_from from rank_thresholds where rank_index = v_prev;

  insert into rank_up_events (user_id, from_rank_index, to_rank_index, from_tier, from_division, to_tier, to_division, season_id)
  values (new.user_id, v_prev, v_index, v_from.tier, v_from.division, v_to.tier, v_to.division, v_season);

  perform economy_credit_pass_xp_for(new.user_id, 'season_new_rank', 500, v_season);  -- unchanged

  -- ── the new reward ──────────────────────────────────────────────
  if v_to.tier = 'primordial' then
    v_embers := 1200; v_box := 'promethean'; v_kind := 'primordial';
  elsif v_to.tier <> v_from.tier then
    v_embers := 300;  v_box := 'furnace';    v_kind := 'tier';
  else
    v_embers := 100;  v_box := 'ignition';   v_kind := 'division';
  end if;

  perform economy_move_embers(new.user_id, v_embers, 'season_reward'::ember_reason, null);
  insert into loot_boxes (user_id, box_key, obtained_via, provenance)
  values (new.user_id, v_box, 'forge_pass'::box_obtained_via,
          'Rank-up reward · ' || initcap(v_to.tier) ||
          case when v_to.tier='primordial' then '' else ' ' ||
            (array['','I','II','III'])[v_to.division+1] end);

  -- ── the bell event (self-notify: actor_id = null) + reveal payload ──
  v_div := case when v_to.tier='primordial' then '' else ' ' || (array['','I','II','III'])[v_to.division+1] end;
  v_label := initcap(v_to.tier) || v_div;
  perform notify_event(
    array[new.user_id], 'ranked_up',
    '⚔️ You ranked up — ' || v_label,
    case v_kind
      when 'primordial' then 'Reached Primordial. The king himself bows toward your greatness.'
      when 'tier'       then 'A new tier. +' || v_embers || ' embers and a box are waiting.'
      else                   'Up a division. +' || v_embers || ' embers and a box are waiting.'
    end,
    null, null, '/inventory', '{}'::jsonb, null, 'hexagon',
    jsonb_build_object('embers', v_embers, 'box', v_box, 'rank', v_label, 'kind', v_kind));

  return new;
end; $$;
```

**No trigger change** — the existing `check_ins_rank_tracking` trigger already calls this function. Confirm `rank_index_for_score` and `user_rank_state` exist (they're referenced by the original 0066 body, so they do). Test: give a test user enough XP to cross a division and a tier; confirm one box + the right ember amount + one bell row each.

---

## ROUTING — challenge/duel rewards use the reveal screen, and notifications deep-link to it (mocks 136/137)

The reward math already lands (0111/0112/0114) and the payout is already stored + readable per participant (`0118`: `challenge_participants.reward_payload` + `reward_seen_at`, `get_challenge_reward`). What's missing is the **reveal screen + the deep-link into it**, so a challenge win feels like a relic/level-up.

**Client — one shared reward-reveal screen** at route `/challenge/[id]/reward`:
- Reads `get_challenge_reward(id)` → `{embers, box, badge, band, placement, xp}`.
- Plays the reveal (mock 137: group placement + prizes; duel = beat-X + prizes). Same reveal component the relic/level-up use (mocks 131/129) — shared, not three copies.
- **Claim** → the embers + XP **fly into the account** (mock 136: embers → balance pill, XP → Flame Pass crest), then the box opens via the existing loot-box open flow. On claim, set `reward_seen_at = now()` (fire-once).
- If `reward_seen_at` is already set, the screen shows the result read-only (no re-grant, no re-animate).

**Server — point the settlement notifications at that route.** In `0118`'s `economy_on_social_challenge_closed` the `challenge_settled` / `campfire_settled` `notify_event` calls currently route to `/challenge-info` / `/group`. Change `p_route` to `'/challenge/[id]/reward'` with `route_params = {id}` **for recipients who have a reward_payload**, and set the body to the mock-137 copy ("You earned a Rare box. Tap to claim."). Include the reward summary in `p_payload` so the push carries it too.

**Both entry points hit the same screen.** The in-app bell row uses `route`/`route_params`; the OS push carries `{route, params}` in its data payload (already how `notify_event` builds the push). So tapping either the bell row or the OS banner opens `/challenge/[id]/reward`. The box stays **unclaimed** (unopened in `loot_boxes`) until the user opens it on that screen — the notification is a claim prompt, not the claim itself.

> Net effect: win → settle pays (server, already works) → notification "claim your box" → tap (in-app or OS) → reward reveal → Claim → prizes fly into account → box opens. No new economy math; this is a route + a screen + a fly-to-account animation.

**Reward boxes = the real named boxes (`src/lib/economy/boxes.ts`, art in `box-art.tsx`).** `grant_reward` already maps significance → box key: Ignition Crate → The Furnace → Vessel of Hestia → Hephaestus' Chest → Promethean Vault. The reward screen renders the actual box via `box-art.tsx` and its real name — not a generic "Rare box". A short duel pays a Furnace; a month-long group win pays a Vessel of Hestia (tunable by the significance thresholds in `grant_reward`).

**Fly-to-account = transient, stacked HUDs (mock 136).** The account targets are NOT permanent header pills. On claim:
- Claim embers → a transient **ember balance** pill surfaces at top, embers fly into it, the number ticks, then it tucks away.
- Claim XP → the **Flame Pass progress** surfaces (XP flies to the crest and lands, never fading mid-air), then tucks away.
- Claim both → the two HUDs **stack** (pass progress on top, ember balance below) so they never fight over the same top-right corner. This is the rule that keeps a combined challenge reward (box + embers + XP) from overcrowding one spot.

## BALANCE — Flame Pass XP economy (from mock 129/131 feedback)

Two rules, now locked:
1. **Tasks pay Pass XP, never embers.** Lock-ins, daily fire, challenges, cheers all grant XP toward the pass.
2. **Leveling up pays embers** (and boxes at milestone levels). The level-up is the reward moment (mock 129 reveal).

**XP needs a big boost.** Current feel is unforgiving — a lock-in nets ~20 embers while a <$2 purchase gives 100, so grinding feels worthless. Fix by making the *pass* generous: raise task XP so a normal day visibly moves the bar, and set per-level embers so leveling feels earned but frequent. Provisional values in mock 129 (`+120 / +200 / +300 / +60 XP` per task, `+250 ✦` per level, ~1,000 XP/level early). Tune the XP curve so an active user levels roughly every 1–2 days early season. This touches `economy_credit_pass_xp_for` amounts and the level→ember payout table — no structural change, just numbers. Flagging as a balance decision, not a silent tweak.

## CATALOG — discipline ladders updated (affects 0119)

Two changes to the `grant_ladder` calls in `0119`:

1. **Hours splits into two ladders** — `deep_work` and `study` are now separate 5-tier ladders (each U/R/E/L/M, thresholds provisional `10/25/50/100/250 h`), not one combined Hours ladder. `session_discipline()` routes a session to `deep_work` or `study`; Meditate folds into one of them or drops (confirm). So the families become: `volume · distance · deep_work · study`.
2. **Final relic names** (replace the placeholder keys/copy):

| Ladder | α | β | γ | δ | Ω |
|---|---|---|---|---|---|
| Gym Volume | First Iron | Forged | Sculpted | Sisyphus' Stone | Hercules' Labours |
| Deep Work | Spark of the Artificer | Feather and Wax | Labyrinth Architect | Flight of the Artificer | Daedalian Mind |
| Studying | Spark of Wonder | Enlightenment | Unexamined Mind | Thought Creation | Oracle's Verdict |
| Distance | (running names stay as-is — "clean") | | | | The Long Road (Ω, 414 km — Pheidippides lore) |

Mirror these into `ITEM_CATALOG.md` §4a-2 and use them as the `economy_grant_relic` copy in `0119`.

## CHALLENGE AUDIT — what lands, what doesn't (mocks 137/139)

Verified against the code:
- **Settlement IS scheduled.** `philoi-finalize-social-challenges` cron runs `finalize_social_challenges()` every 10 min (`0019`). So challenges do settle — *if the migrations are deployed and pg_cron is enabled in prod.*
- **Live/intra progress IS computed.** `get_my_social_challenges` returns live `my_score`/`opponent_score` (H2H) and `member_count`/`completed_count` (group) via `social_challenge_score` / `challenge_metric_value`. The data is there.
- **So the two complaints are:**
  1. *"Reward doesn't fire when a challenge is done"* → the **deploy gate**, not logic. `grant_reward` never returned successfully until `0114`, and `0112` (loop repair) was missing in prod. Deploy 0112/0114/0118 and confirm pg_cron is on. Then settlement pays.
  2. *"Progress isn't meaningful"* → **UI**, not data. The live score is returned but the card doesn't make it feel like a race. Fix in the challenge-card enhancement (#122): show a live progress bar (your score vs target, or vs opponent), "X to catch up / X ahead", and time remaining. For a "most X" group race, show live rank. No new server work — bind to the fields already returned.

## Migration `0122_h2h_tie_pays_both.sql` — ties reward everyone tied (meritocracy)

**Group ties: already correct.** `finalize_social_challenges` ranks the group with `rank() over (order by score desc)`, so tied players share a placement (two at 40 km → both rank 1, next is rank 3), and the reward trigger pays per that placement — ties get identical rewards automatically. No change needed. (If group rewards later become placement-scaled, `rank()` still makes ties share.)

**H2H ties: broken — a draw currently pays nobody** (`finalize_social_challenges`: `else null` winner, and "A draw pays nobody"). Fix so a genuine tie pays **both** the full winner reward:

```sql
-- 0122 — an H2H draw where both actually competed pays BOTH the winner reward.
-- Two edits, both narrow. Reward math unchanged; this only changes WHO is paid on a tie.

-- 1) finalize: on a scoring tie with real activity, award the winner bonus-XP to BOTH.
--    (Redefine finalize_social_challenges from 0112; only the h2h payout block changes —
--     replace the single-winner bonus_xp insert with:)
--       if v_winner is not null then
--         insert into bonus_xp_awards(user_id,amount,reason,challenge_id)
--         values (v_winner, r.payout_xp, 'challenge_h2h_winner', r.id);
--       elsif v_my = v_opp and v_my > 0 then          -- real tie, both competed
--         insert into bonus_xp_awards(user_id,amount,reason,challenge_id)
--         values (r.created_by, r.payout_xp, 'challenge_h2h_winner', r.id),
--                (r.opponent_id, r.payout_xp, 'challenge_h2h_winner', r.id);
--       end if;
--    (participant final_rank/percentile already set both to 1 / 1.0 on a null winner — keep that.)

-- 2) reward trigger: economy_on_social_challenge_closed (0118) currently grants the box/embers
--    off new.winner_id. On a tie winner_id is null, so nobody is paid. Add a tie branch:
--    for an h2h that completed with winner_id IS NULL, check the two participants' final_value;
--    if equal and > 0, call grant_reward(..., 'friend_h2h', ...) for BOTH with the winner's
--    placement_pct (0.0), storing each payout on their challenge_participants row (as 0118 does).
--    A both-zero no-show stays unpaid.
```

Net: a real duel that ends dead-even pays both players the full Furnace/embers/XP — "a good fight." Both-did-nothing stays unpaid.

## Group challenge leaderboard (mock 139)

Tapping the orange placement chip opens the challenge leaderboard. Data already exists: `challenge_field` + `social_challenge_score` per member (live), or `challenge_participants.final_value`/`final_rank` (settled). Client route `/challenge/[id]/board`:
- Ranked rows with score, your row highlighted, **ties share a rank** (render `rank()` output — two "1"s, then "3") with a small TIE badge.
- **Share** button exports the card (mock 139-3), reusing the existing share-card export path.

## LOGIC — daily / weekly pass-task refresh (mock 138)

Tasks that refill so consistency out-levels bingeing. Model it like the goal-day pattern (compute-per-period, don't materialize a queue):

```
-- pass_task_defs: the catalog. id, cadence text check in ('daily','weekly'), key, label,
--   metric text, target numeric, xp_reward int, active bool.
-- pass_task_claims: user_id, task_key, period_start date, claimed_at timestamptz,
--   primary key (user_id, task_key, period_start).   -- one claim per task per period
```
- **Period key:** daily = local date (local midnight reset, reuse the local-midnight logic from `0084`); weekly = the Sunday-anchored week start (reuse `0071`/`0077` week helper). This makes "refresh" implicit — a new period = a new `period_start` = progress recomputes from 0 and there's no claim row yet.
- **Progress (read):** `get_pass_tasks()` returns each active def with the user's current-period progress (computed from `check_ins`/sessions/challenge wins over `[period_start, now]`, same metric functions challenges use) and whether it's claimed.
- **Claim:** `claim_pass_task(key)` — verify progress ≥ target and no existing claim for the period, insert the claim row, and `economy_credit_pass_xp_for(user, 'pass_task', xp_reward, season)`. XP → the pass; leveling still pays the embers (per the BALANCE rule above).
- No cron needed for the refresh itself (period-keyed). Optional: a daily push "your daily tasks refreshed."

## ⚠️ Referral blocker (Prometheus' Shard)
There is **no referral system** in the codebase (grepped all migrations — only an unrelated string match in 0080). Prometheus' Shard's second condition ("refer someone") has no data source. Options:
1. **Build a minimal referral system** — invite code on the profile, attributed at signup; `has_successful_referral(user)` = "≥1 account signed up with my code and completed onboarding." Then Prometheus unlocks fully.
2. **Ship Prometheus gated** (as written above, behind `has_successful_referral`) so it can't grant until referrals exist — safe, but the relic is dormant.

Recommend (1) as a small standalone task; it also powers growth loops. Flagging for your call before 0119 ships, since the evaluator references `has_successful_referral`.
