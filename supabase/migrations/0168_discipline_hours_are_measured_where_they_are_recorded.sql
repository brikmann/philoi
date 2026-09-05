-- 0168 — the three Hours ladders (Socrates' Scroll · Daedalus' Blueprint · Oracle's Stillness) and
-- the Anvil measure a duration that does not exist, so they read ~0 for everyone. Additive: one
-- function body, plus a re-evaluation so the corrected numbers arrive rather than waiting for each
-- user's next check-in.
--
-- ─────────────────────────────── WHAT IS WRONG ───────────────────────────────
--
-- 0119 sums `extract(epoch from (s.last_confirmed_at - s.started_at)) / 3600.0` over
-- lock_in_sessions, in two places: the Anvil of Hephaestus branch (§4a, 500 h) and the grouped
-- pass that feeds all three Hours ladders (§4a-2).
--
-- lock_in_sessions HAS NO DURATION COLUMN. `last_confirmed_at` is a heartbeat stamp, and on prod
-- (measured 2026-08-30) it equals `started_at` on 151 of 164 completed sessions — 92.1%. So that
-- expression evaluates to ~0 per row and its sum is a near-constant that barely moves when
-- somebody actually locks in.
--
-- This is the SAME bug 0144 fixed in challenge_metric_value, where it cost a settlement: two
-- racers with 81 and 71 completed sessions both scored 23007.833970, and a duel the live card
-- correctly showed as a 1h 40m win was paid out as a dead heat. 0144's header names the general
-- rule — "treat any other last_confirmed_at - started_at expression as a suspected instance of
-- this bug" — and economy_evaluate_relics is the surviving instance.
--
-- The consequence here is quieter and worse for the feature: a user with 60 real study hours has a
-- Socrates' Scroll ladder reading roughly zero, so §4a-2's whole "running progression milestone"
-- never starts. Daedalus' Blueprint, the relic this build is for, cannot move at all.
--
-- ─────────────────────────────── THE FIX ───────────────────────────────
--
-- A lock-in's length is `check_ins.duration_seconds` and nowhere else — written when the session
-- ends (0007), and the same column social_challenge_score, challenge_metric_value (since 0144) and
-- check_in_qualifies_for_challenge all read.
--
-- Read it off check_ins DIRECTLY rather than joining back through lock_in_sessions.ended_check_in_id:
--   · `check_ins.goal_type` is denormalised on every row (0012), so the discipline is already there
--     and the join buys nothing;
--   · a check-in with a duration and no session row still counts, which is the honest reading of
--     "cumulative hours in that discipline";
--   · one grouped scan of check_ins replaces a scan of lock_in_sessions plus a join.
--
-- FILTERS, and the one deliberately NOT applied:
--   · `removed_at is null` — a deleted check-in stops counting, as it does for every other metric.
--     (relic_progress.tier is a high-water mark, so a removal still cannot take a rung back off
--     anyone; only the displayed value falls.)
--   · `duration_seconds is not null` — a photo check-in proves a day, not an hour.
--   · NOT check_in_qualifies_for_challenge(). That gate is 0033's 20-minute anti-farming floor,
--     built for races, where a rival loses when a padded score wins. A relic is ipsative — nobody
--     else is ranked by it — and the floor would gut the one ladder whose real sessions are
--     shortest: Oracle's Stillness, where a 12-minute sit is a genuine meditation and a 20-minute
--     rule would silently discard it. What farming this buys is a showcase item worth zero XP that
--     cannot be equipped, sold or salvaged, so the incentive the floor exists to remove is absent.
--
-- Everything else is 0119's body unchanged, restated because it is one function: the Icarus/Zeus
-- rank branches, the Aegis gaps-and-islands streak, the dormant Prometheus gate, Atlas' Burden and
-- the Volume/Distance ladders (none of which ever read the broken expression) all keep their exact
-- 0119 semantics.
--
-- ⚠️ NO `grant execute` AT THE BOTTOM. 0119 ended with `grant execute on economy_evaluate_relics to
-- authenticated`; 0132 revoked it deliberately — an evaluator reachable as an RPC is a way of
-- asking for a grant repeatedly until it lands. Re-granting here would silently undo 0132.

create or replace function economy_evaluate_relics(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granted int := 0;
  v_hours numeric;
  v_tier text;
  v_pos int;
  v_weeks int;
  v_top10 boolean;
  v_volume numeric;
  v_km numeric;
  v_bench numeric;
  v_squat numeric;
  v_dead numeric;
  v_disc record;
  v_maxed int;
begin
  if p_user is null then return 0; end if;

  -- ── ANVIL OF HEPHAESTUS · legendary · 500 cumulative hours ──
  -- THE REPAIR, half one. Was lock_in_sessions.(last_confirmed_at - started_at), ~0 per row, which
  -- made a 500-hour relic unreachable by construction rather than by difficulty.
  select coalesce(sum(ci.duration_seconds) / 3600.0, 0) into v_hours
  from check_ins ci
  where ci.user_id = p_user
    and ci.removed_at is null
    and ci.duration_seconds is not null;

  if v_hours >= 500 then
    if economy_grant_relic(p_user, 'relic-anvil-of-hephaestus', 'legendary',
      '500 hours, forged. The work did not fill time — it made you the weapon.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ICARUS' FEATHER · legendary · reach HERO ──
  select t.tier into v_tier from rank_tier_for_score(universal_score(p_user)) t limit 1;
  v_pos := array_position(
    array['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial'],
    v_tier);

  if coalesce(v_pos, 0) >= 6 then
    if economy_grant_relic(p_user, 'relic-icarus-feather', 'legendary',
      'You climbed to Hero — flew close to the sun and ascended past what was thought possible.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ZEUS' BOLT · mythic · reach PRIMORDIAL ──
  if v_tier = 'primordial' then
    if economy_grant_relic(p_user, 'relic-zeus-bolt', 'mythic',
      'You reached Primordial. The king himself bows toward your greatness.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ATHENA'S AEGIS · epic · 6 CONSECUTIVE weeks with a session ──
  -- Unchanged from 0119, and deliberately still sourced from lock_in_sessions: this branch counts
  -- WEEKS, asking only whether a session exists in each one and never how long it ran, so the
  -- duration bug never touched it.
  with wk as (
    select distinct date_trunc('week', s.started_at)::date as d
    from lock_in_sessions s
    where s.user_id = p_user and s.status = 'completed'
  ), grouped as (
    select d, d - make_interval(weeks => (row_number() over (order by d))::int) as grp from wk
  )
  select coalesce(max(cnt), 0) into v_weeks
  from (select count(*) as cnt from grouped group by grp) s;

  if v_weeks >= 6 then
    if economy_grant_relic(p_user, 'relic-athenas-aegis', 'epic',
      'Six weeks unbroken, without a gap. Athena guards the standard that is never set down.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── PROMETHEUS' SHARD · mythic · top-10% season finish AND a referral ──
  -- Still dormant: has_successful_referral() is 0119's documented stub. The top-10% half is
  -- evaluated anyway so that everyone already qualifying is granted on their next check-in the
  -- moment referrals land, with no backfill.
  select exists (
    select 1 from season_standings s
    where s.user_id = p_user
      and s.rank::numeric / greatest(s.board_size, 1) <= 0.10
  ) into v_top10;

  if v_top10 and has_successful_referral(p_user) then
    if economy_grant_relic(p_user, 'relic-prometheus-shard', 'mythic',
      'You reached the top and brought someone into the fire. Mastery that spreads.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── ATLAS' BURDEN · mythic · the 1000 lb club (§4a-3) ── unchanged from 0119.
  select coalesce(max(coalesce(ws.weight, 0)), 0) into v_bench
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user and we.name ilike '%bench%';

  select coalesce(max(coalesce(ws.weight, 0)), 0) into v_squat
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user
    and we.name ilike '%squat%'
    and we.name not ilike '%split%'
    and we.name not ilike '%jump%'
    and we.name not ilike '%thrust%';

  select coalesce(max(coalesce(ws.weight, 0)), 0) into v_dead
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user and (we.name ilike '%deadlift%' or we.name ilike '%rdl%');

  if v_bench + v_squat + v_dead >= 1000 then
    if economy_grant_relic(p_user, 'relic-atlas-burden', 'mythic',
      'A thousand pounds across the three great lifts. Atlas nods in approval.')
    then v_granted := v_granted + 1; end if;
  end if;

  -- ── DISCIPLINE LADDER · VOLUME (Hercules' Might) ── unchanged from 0119.
  select coalesce(sum(coalesce(ws.weight, 0) * ws.reps), 0) into v_volume
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user;

  perform economy_apply_relic_ladder(p_user, 'volume', v_volume);

  -- ── DISCIPLINE LADDER · DISTANCE (Pheidippides' Sandals) ── unchanged from 0119.
  select
    coalesce((select sum(ci.distance_m) from check_ins ci
              where ci.user_id = p_user and ci.removed_at is null), 0)
    + coalesce((select sum(sd.steps) * stride_m_for(p_user) from user_step_days sd
                where sd.user_id = p_user), 0)
  into v_km;
  v_km := v_km / 1000.0;

  perform economy_apply_relic_ladder(p_user, 'distance', v_km);

  -- ── DISCIPLINE LADDERS · HOURS, one per discipline ──
  --
  -- THE REPAIR, half two. Socrates' Scroll (study) · Daedalus' Blueprint (deep work) · Oracle's
  -- Stillness (meditate), each on §4a-2's 10 / 25 / 50 / 100 h ladder.
  --
  -- session_discipline() is 0119's map and is unchanged, so the routing it documents still holds:
  -- `read` folds into study (§4a-2 "Reading counts as study"), `job_applications` is the only
  -- current GoalType that fits deep work, `run` rides Distance instead, and `custom` is
  -- deliberately unmapped rather than credited to a discipline the user did not pick. It is fed
  -- check_ins.goal_type here rather than lock_in_sessions.goal_type — the same denormalised value,
  -- read off the row that actually carries the duration.
  --
  -- ONE grouped pass, not one query per family: this function runs on every check-in insert, and a
  -- query per hours-ladder would be three more scans of the hottest table in the app.
  --
  -- A discipline with no hours gets no row, which costs nothing — get_my_relic_progress and
  -- get_trophy_hall both LEFT JOIN from relic_ladders, so all five ladders still report.
  for v_disc in
    select session_discipline(ci.goal_type) as family,
           sum(ci.duration_seconds) / 3600.0 as hours
    from check_ins ci
    where ci.user_id = p_user
      and ci.removed_at is null
      and ci.duration_seconds is not null
      and session_discipline(ci.goal_type) is not null
    group by 1
  loop
    perform economy_apply_relic_ladder(p_user, v_disc.family, v_disc.hours);
  end loop;

  -- ── CROWN OF OLYMPUS · mythic · top rung of every discipline ladder (§4a-2 capstone) ──
  -- Counted against relic_ladders rather than a literal 5, so a discipline added later joins the
  -- capstone's requirement by INSERT and needs no change here.
  select count(*) into v_maxed
  from relic_progress rp
  join relic_ladders rl on rl.relic_key = rp.relic_key
  where rp.user_id = p_user and rp.tier >= array_length(rl.thresholds, 1);

  if v_maxed >= (select count(*) from relic_ladders) then
    if economy_grant_relic(p_user, 'relic-crown-of-olympus', 'mythic',
      'Master of no single art, but of the discipline beneath all of them. Olympus has a seat for that.')
    then v_granted := v_granted + 1; end if;
  end if;

  return v_granted;
end;
$$;

-- ───────────────────────── re-evaluate, with the corrected hours ─────────────────────────
--
-- REQUIRED, not housekeeping. relic_progress.value for the three Hours ladders currently holds the
-- ~0 figure the broken expression produced. Nothing recomputes it on its own — economy_evaluate_relics
-- runs only on a check-in insert or a completed session — so without this, every existing user opens
-- the new profile shelf to three ladders reading "0.1 / 10 h" and stays there until their next
-- lock-in. That is the same "the relic has progress and the Hall cannot see it" state 0123 exists to
-- prevent, just one release later.
--
-- RE-RUNNABLE, for 0123's reasons: economy_grant_relic returns false for a relic already owned, and
-- economy_apply_relic_ladder only notifies on a rung it has not already recorded.
--
-- NO PUSH BLAST. Users whose real hours were being measured as zero will cross several rungs at once
-- here, and each rung calls notify_event, which ends in net.http_post to Expo. `philoi.suppress_push`
-- (0120) skips the send while still writing every bell row — so the unlocks are there to find in the
-- bell and the Trophy Hall, they just do not banner the whole user base at 3am for hours logged in June.
--
-- `set local` is transaction-scoped and the CLI wraps each migration in one. Run inside BEGIN/COMMIT
-- if this is ever applied by hand.
set local philoi.suppress_push = 'on';

do $$
declare
  v_user uuid;
  v_n int := 0;
begin
  -- Only accounts with a durationed check-in: the Hours ladders are the only thing this migration
  -- changes, and a user with no logged time has nothing whose value could have moved. Narrower than
  -- 0123's scan on purpose — that one was seeding five ladders from nothing.
  for v_user in
    select distinct ci.user_id
    from check_ins ci
    where ci.removed_at is null and ci.duration_seconds is not null
  loop
    -- One user failing must not abandon the rest, for 0123's reason: the likely cause is a profile
    -- deleted between the scan and the call, which is a no-op worth skipping rather than a reason to
    -- roll the whole re-evaluation back.
    begin
      perform economy_evaluate_relics(v_user);
      v_n := v_n + 1;
    exception when others then
      raise warning 'relic hours re-evaluation skipped user % — %', v_user, sqlerrm;
    end;
  end loop;

  raise notice 'discipline hours re-evaluation: % users', v_n;
end;
$$;
