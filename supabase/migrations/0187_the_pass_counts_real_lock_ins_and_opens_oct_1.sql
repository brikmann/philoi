-- 0187 — The Pass counts the lock-ins people actually do, the season close stops crashing, and
-- Emberfall opens on Oct 1.
--
-- Four launch-gating findings from the Emberfall verify (2026-09-14), all Pass/season, one file.
-- Ships with its client half: SEASON in src/lib/economy/forge-pass.ts moves to the same instants.
-- 0185 (the anon revokes) must already be applied — every function replaced here keeps the ACL 0185
-- left on it, because CREATE OR REPLACE with an identical signature does not touch grants.
--
-- ─────────────────────── A · PASS XP WAS DEAD ───────────────────────
--
-- evaluate_pass_achievements (0065, 0071) read a session's length as last_confirmed_at − started_at
-- and INNER JOINed goals. On prod, every one of the 199 completed sessions has goal_id null (the
-- category/course lock-in shape since 0182) and last_confirmed_at == started_at on nearly all of
-- them — the real length lives in check_ins.duration_seconds via ended_check_in_id. So the join
-- dropped every row and the duration filter would have dropped the rest: 0 Pass XP from 14+ real
-- lock-ins. Now:
--   · duration  = check_ins.duration_seconds through ended_check_in_id — the same source rank XP
--                 uses, so the two ladders cannot disagree about how long someone worked.
--   · goals     = LEFT JOIN, kept only as a fallback type for legacy goal-bound sessions.
--   · "gym"     = the session's own goal_type ('gym' on fitness/strength), or activity = 'strength'.
--   · "type"    = coalesce(session goal_type, goal.type, category) for "different from yesterday".
-- The trigger (lock_in_sessions_economy, AFTER UPDATE OF status) fires on the same UPDATE that
-- stop_lock_in_session uses to stamp ended_check_in_id, after the check-in row is inserted, so the
-- join always has its row. get_pass_achievement_progress gets the identical fix — it is the
-- "6.5 / 10 h" the Pass screen shows, and a counter reading a different source than the engine
-- that pays would show 0 h beside XP that just landed.
--
-- ─────────────────────── B · THE SEASON CLOSE CRASHED ───────────────────────
--
-- snapshot_season_standings tiebroke on f.created_at; forge_pass_state has no created_at. The
-- 02:00 philoi-season-placement-close cron would have thrown on the first night past ends_at, and
-- placement rewards (#92) would never pay. The tiebreak is now "reached that XP first" — the
-- latest ledger credit — then p.id. Not premium_granted_at: ordering equal XP by who paid would
-- make the free lane rank below the paid one on a tie.
--
-- Placement idempotency only checked for a prior closure at the START and wrote the closure row at
-- the END, so two overlapping runs could both pay. Both entry points now take the same
-- transaction-scoped advisory lock before that check. A second run blocks until the first commits,
-- then — READ COMMITTED gives the next statement a fresh snapshot — sees the closure and returns.
--
-- ─────────────────────── C · THE OCT 1 POSTPONEMENT NEVER HAPPENED ───────────────────────
--
-- No migration ever moved the window; prod has been live since 2026-09-10. Confirmed by Noah: Oct 1,
-- locked. Both edges at Eastern local midnight — Oct 1 is EDT (−4), Dec 23 is EST (−5). The old
-- values were UTC midnight, i.e. 8pm the evening before.
--
-- ⚠ Installed builds carry the OLD constant and OTA cannot reach them. Until the launch build
-- ships, they render the season as live and can open the Pass purchase sheet; grant_forge_pass will
-- refuse (phase 'upcoming'), RevenueCat still records the receipt in iap_grants, and
-- reconcile_my_forge_pass honours that receipt once the season opens.
--
-- ─────────────────────── D · PRE-SEASON XP ───────────────────────
--
-- Two season_new_rank credits (500 each, 2026-08-10) predate the window being enforced. A season
-- that opens Oct 1 starts from zero: every S1 ledger row older than the new starts_at is removed and
-- pass_xp is recounted from the ledger. Refuses to run if any S1 level claim exists, since a
-- claimed level would outlive the XP that unlocked it (there are none on prod today).

-- ── base check · restated from the LIVE bodies ──
-- A sibling migration replacing one of these after this file was drafted would be silently reverted
-- by the CREATE OR REPLACE below. Refuse instead.
do $base$
declare
  v_moved text;
begin
  select string_agg(b.name, ', ') into v_moved
  from (values
    ('evaluate_pass_achievements',     '25394c1ef7768fcdf0c2a4b105802368'),
    ('get_pass_achievement_progress',  '0a58301ed65100736482449995a37a1f'),
    ('snapshot_season_standings',      '6932ef3142c546ff79c6c8f873d4b6fe'),
    ('close_season_placements',        '710de428a9907a0dd79e7d85c04936ef'),
    ('grant_season_placement_rewards', '734a3f5df7aeab539a023e49f390e317')
  ) b(name, md5)
  join pg_proc p on p.proname = b.name and p.pronamespace = 'public'::regnamespace
  where md5(p.prosrc) <> b.md5;
  if v_moved is not null then
    raise exception '0187: live body changed since this file was drafted: % — rebase onto it', v_moved;
  end if;
end;
$base$;

-- ─────────────────────────────── A ───────────────────────────────

create or replace function evaluate_pass_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := to_char(now(), 'YYYY-MM-DD');
  v_week text := week_key();
  v_season text := (select value ->> 'id' from economy_config where key = 'season');
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today_count int;
  v_today_deep boolean;
  v_today_gym boolean;
  v_today_types text[];
  v_yesterday_types text[];
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
  v_streak_days int;
begin
  -- ── daily ──
  -- 0187: length from the check-in the session ended in; goals is a fallback, not a filter.
  select count(*),
         bool_or(c.duration_seconds >= 5400),
         bool_or(coalesce(s.goal_type, g.type) ilike '%gym%' or (s.category = 'fitness' and s.activity = 'strength')),
         array_agg(distinct coalesce(s.goal_type, g.type, s.category))
    into v_today_count, v_today_deep, v_today_gym, v_today_types
  from lock_in_sessions s
  join check_ins c on c.id = s.ended_check_in_id and c.removed_at is null
  left join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and coalesce(c.duration_seconds, 0) >= v_min;

  if coalesce(v_today_count, 0) >= 1 then
    perform economy_credit_pass_xp_for(p_user, 'daily_first_lock_in', 50, v_day);
  end if;
  if coalesce(v_today_count, 0) >= 3 then
    perform economy_credit_pass_xp_for(p_user, 'daily_three_lock_ins', 75, v_day);
  end if;
  if coalesce(v_today_deep, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_deep_session', 100, v_day);
  end if;
  if coalesce(v_today_gym, false) then
    perform economy_credit_pass_xp_for(p_user, 'daily_gym_lock_in', 60, v_day);
  end if;

  -- "A different goal type than yesterday" — rewards varying what you do, which is the habit the
  -- app is actually trying to build (FORGE_PASS wellbeing note).
  select array_agg(distinct coalesce(s.goal_type, g.type, s.category)) into v_yesterday_types
  from lock_in_sessions s
  left join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now()) - interval '1 day'
    and s.started_at < date_trunc('day', now());

  if v_today_types is not null and v_yesterday_types is not null
     and exists (select 1 from unnest(v_today_types) t where t <> all(v_yesterday_types)) then
    perform economy_credit_pass_xp_for(p_user, 'daily_different_goal', 40, v_day);
  end if;

  -- ── weekly ── (Sunday-anchored as of 0071)
  select count(distinct s.started_at::date),
         coalesce(sum(c.duration_seconds), 0),
         count(*) filter (where coalesce(s.goal_type, g.type) ilike '%gym%' or (s.category = 'fitness' and s.activity = 'strength'))
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join check_ins c on c.id = s.ended_check_in_id and c.removed_at is null
  left join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= week_start()
    and coalesce(c.duration_seconds, 0) >= v_min;

  if coalesce(v_week_days, 0) >= 6 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_six_active_days', 300, v_week);
  end if;
  if coalesce(v_week_seconds, 0) >= 36000 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_ten_hours', 250, v_week);
  end if;
  if coalesce(v_week_gym, 0) >= 5 then
    perform economy_credit_pass_xp_for(p_user, 'weekly_five_gym', 200, v_week);
  end if;

  -- ── season ──
  select count(distinct s.started_at::date) into v_streak_days
  from lock_in_sessions s
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= now() - interval '30 days';

  if coalesce(v_streak_days, 0) >= 30 then
    perform economy_credit_pass_xp_for(p_user, 'season_thirty_day_streak', 500, v_season);
  end if;
end;
$$;

create or replace function get_pass_achievement_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_min int := (select value::int from economy_config where key = 'lock_in_min_seconds');
  v_today int;
  v_week_days int;
  v_week_seconds numeric;
  v_week_gym int;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  -- 0187: the same source and the same filters as evaluate_pass_achievements, so the counter and
  -- the payout cannot disagree.
  select count(*) into v_today
  from lock_in_sessions s
  join check_ins c on c.id = s.ended_check_in_id and c.removed_at is null
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and coalesce(c.duration_seconds, 0) >= v_min;

  select count(distinct s.started_at::date),
         coalesce(sum(c.duration_seconds), 0),
         count(*) filter (where coalesce(s.goal_type, g.type) ilike '%gym%' or (s.category = 'fitness' and s.activity = 'strength'))
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join check_ins c on c.id = s.ended_check_in_id and c.removed_at is null
  left join goals g on g.id = s.goal_id
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= week_start()
    and coalesce(c.duration_seconds, 0) >= v_min;

  return jsonb_build_object(
    'daily_three_lock_ins', coalesce(v_today, 0),
    'weekly_six_active_days', coalesce(v_week_days, 0),
    'weekly_ten_hours', round(coalesce(v_week_seconds, 0) / 3600.0, 1),
    'weekly_five_gym', coalesce(v_week_gym, 0)
  );
end;
$$;

-- ─────────────────────────────── B ───────────────────────────────

create or replace function snapshot_season_standings(p_season text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_rows int;
begin
  insert into season_standings (season_id, university, user_id, rank, board_size, pass_xp, pass_level)
  select
    v_season,
    p.university,
    p.id,
    -- 0187: was `f.created_at asc` — a column forge_pass_state has never had. Equal XP now goes to
    -- whoever reached it first.
    row_number() over (partition by p.university order by f.pass_xp desc, reached.at asc nulls last, p.id asc),
    count(*) over (partition by p.university),
    f.pass_xp,
    economy_level_from_xp(f.pass_xp)
  from profiles p
  join forge_pass_state f on f.user_id = p.id and f.season_id = v_season
  left join lateral (
    select max(l.created_at) as at
    from pass_xp_ledger l
    where l.user_id = p.id and l.season_id = v_season
  ) reached on true
  where not p.is_demo
    and not p.is_disabled
    and p.university is not null
    and p.university_email_verified
    -- Zero-XP accounts are not "last place", they simply didn't play. Ranking them would inflate
    -- every board_size and hand out Top-50% titles to people who never opened the Pass.
    and f.pass_xp > 0
  on conflict (season_id, university, user_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function close_season_placements()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := season_config() ->> 'id';
begin
  if season_phase() in ('upcoming', 'live') then return; end if;

  -- 0187: serialize BEFORE the check. Held to commit, so the second run's check sees the closure.
  perform pg_advisory_xact_lock(hashtext('philoi.season_placements'), hashtext(v_season));
  if exists (select 1 from season_placement_closures where season_id = v_season) then return; end if;

  perform snapshot_season_standings(v_season);
  perform grant_season_placement_rewards(v_season, false);
end;
$$;

create or replace function grant_season_placement_rewards(p_season text default null, p_dry_run boolean default false)
returns table(university text, ranked integer, granted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := coalesce(p_season, season_config() ->> 'id');
  v_stamp text;
  v_band text;
  v_pct numeric;
  v_granted int := 0;
  r record;
begin
  -- 0187: the same lock close_season_placements takes (re-entrant within one transaction), so a
  -- direct service-role call cannot race the cron either.
  if not p_dry_run then
    perform pg_advisory_xact_lock(hashtext('philoi.season_placements'), hashtext(v_season));
  end if;

  if not p_dry_run and exists (select 1 from season_placement_closures where season_id = v_season) then
    raise notice 'Season % placement rewards already granted; nothing to do.', v_season;
    return query select s.university, count(*)::int, 0
      from season_standings s where s.season_id = v_season group by s.university;
    return;
  end if;

  for r in
    select * from season_standings s where s.season_id = v_season order by s.university, s.rank
  loop
    v_pct := r.rank::numeric / greatest(r.board_size, 1);
    v_band := season_band(r.rank, r.board_size);
    v_stamp := '🎓 ' || upper(r.university) || ' · ' ||
      case
        when r.rank = 1 then '#1'
        when r.rank <= 10 then 'TOP 10'
        when v_pct <= 0.01 then 'TOP 1%'
        when v_pct <= 0.10 then 'TOP 10%'
        else 'TOP 50%'
      end || ' · ' || v_season;

    if not p_dry_run then
      -- ── exclusive placement band ──
      if r.rank = 1 then
        perform economy_grant_cosmetic(r.user_id, 'card-emberfall-sovereign', 'card', 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_grant_title(r.user_id, 'title-emberfall-champion', 'Season ' || v_season || ' Champion', v_stamp);
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-champion', null, 'mythic', 'earned', 'Season ' || v_season || ' Champion');
        perform economy_move_embers(r.user_id, 5000, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'card', 'card-emberfall-sovereign', 'Emberfall Sovereign', 'mythic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-champion', 'Champion Medal', 'mythic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 5000);
      elsif r.rank <= 10 then
        perform economy_grant_cosmetic(r.user_id, 'banner-emberfall-elite', 'banner', 'legendary', 'earned', 'Season ' || v_season || ' Top 10');
        perform economy_grant_title(r.user_id, 'title-emberfall-elite', 'Season ' || v_season || ' Top 10', v_stamp);
        perform economy_move_embers(r.user_id, 2500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'banner', 'banner-emberfall-elite', 'Emberfall Elite', 'legendary', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 2500);
      elsif v_pct <= 0.01 then
        perform economy_grant_cosmetic(r.user_id, 'particle-emberfall-ascendant', 'particle', 'epic', 'earned', 'Season ' || v_season || ' Top 1%');
        perform economy_grant_title(r.user_id, 'title-emberfall-ascendant', 'Season ' || v_season || ' Top 1%', v_stamp);
        perform economy_move_embers(r.user_id, 1500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'particle', 'particle-emberfall-ascendant', 'Emberfall Ascendant', 'epic', true, null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 1500);
      elsif v_pct <= 0.10 then
        insert into loot_boxes (user_id, box_key, obtained_via, provenance)
        values (r.user_id, 'furnace', 'season', 'Season ' || v_season || ' Top 10%');
        perform economy_grant_title(r.user_id, 'title-emberfall-contender', 'Season ' || v_season || ' Top 10%', v_stamp);
        perform economy_move_embers(r.user_id, 750, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'box', 'furnace', 'Furnace Chest', null, false, 1);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 750);
      elsif v_pct <= 0.50 then
        perform economy_grant_title(r.user_id, 'title-emberfall-initiate', 'Season ' || v_season || ' Top 50%', v_stamp);
        perform economy_move_embers(r.user_id, 500, 'season_reward', null);
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'embers', 'embers', 'Embers', null, false, 500);
      end if;

      -- ── orthogonal medals ──
      if r.pass_level >= 100 then
        perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-centurion', null, 'legendary', 'earned', 'Season ' || v_season || ' · Level 100');
        perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-centurion', 'Centurion Medal', 'legendary', true, null);
      end if;
      perform economy_grant_cosmetic(r.user_id, 'medal-emberfall-participant', null, 'common', 'earned', 'Season ' || v_season || ' · took part');
      perform season_log_grant(v_season, r.user_id, 'pass', v_band, 'medal', 'medal-emberfall-participant', 'Participant Medal', 'common', true, null);
    end if;

    v_granted := v_granted + 1;
  end loop;

  if not p_dry_run then
    insert into season_placement_closures (season_id, boards, granted)
    select v_season, count(distinct s.university), v_granted from season_standings s where s.season_id = v_season
    on conflict (season_id) do nothing;
  end if;

  return query select s.university, count(*)::int, v_granted
    from season_standings s where s.season_id = v_season group by s.university;
end;
$$;

-- ─────────────────────────────── C ───────────────────────────────

update economy_config
   set value = value || jsonb_build_object(
     'starts_at', '2026-10-01T04:00:00Z',
     'ends_at',   '2026-12-23T05:00:00Z'
   )
 where key = 'season' and value ->> 'id' = 'S1';

-- ─────────────────────────────── D ───────────────────────────────

do $guard$
begin
  if exists (select 1 from pass_claims where season_id = 'S1' and tier > 0) then
    raise exception '0187: S1 already has level claims; zeroing pre-season XP would strand them — resolve by hand';
  end if;
end;
$guard$;

delete from pass_xp_ledger
 where season_id = 'S1'
   and created_at < '2026-10-01T04:00:00Z';

update forge_pass_state f
   set pass_xp = coalesce((
     select sum(l.xp) from pass_xp_ledger l where l.user_id = f.user_id and l.season_id = f.season_id
   ), 0)
 where f.season_id = 'S1';

-- ─────────────────────────────── ASSERT ───────────────────────────────
do $assert$
declare
  v_bad text;
begin
  -- C · the edges, from both sides. A UTC-midnight value or a wrong offset fails one of these.
  if season_phase('2026-10-01T03:59:59Z') <> 'upcoming' then raise exception '0187: opens before Oct 1 00:00 EDT'; end if;
  if season_phase('2026-10-01T04:00:00Z') <> 'live' then raise exception '0187: not live at Oct 1 00:00 EDT'; end if;
  if season_phase('2026-12-23T04:59:59Z') <> 'live' then raise exception '0187: closes before Dec 23 00:00 EST'; end if;
  if season_phase('2026-12-23T05:00:00Z') <> 'claim-window' then raise exception '0187: still live at Dec 23 00:00 EST'; end if;

  -- D · no pre-season credit survives, and every pass_xp is its ledger's sum (recount agreement,
  -- not a hard-coded count — this runs on live data).
  if exists (select 1 from pass_xp_ledger where season_id = 'S1' and created_at < '2026-10-01T04:00:00Z') then
    raise exception '0187: pre-season S1 ledger rows remain';
  end if;
  select string_agg(f.user_id::text, ', ') into v_bad
  from forge_pass_state f
  where f.season_id = 'S1'
    and f.pass_xp <> coalesce((select sum(l.xp) from pass_xp_ledger l where l.user_id = f.user_id and l.season_id = 'S1'), 0);
  if v_bad is not null then raise exception '0187: pass_xp disagrees with its ledger for %', v_bad; end if;

  -- A/B · the bodies resolve. plpgsql binds columns only when a statement first runs, which is how
  -- f.created_at reached prod: running them is the check. Null user and an unused season id write
  -- nothing, and phase is 'upcoming' so no credit could land anyway.
  perform evaluate_pass_achievements(null);
  perform snapshot_season_standings('0187-selftest');
  if exists (select 1 from season_standings where season_id = '0187-selftest') then
    raise exception '0187: self-test left standings behind';
  end if;

  -- 0185 still holds on everything replaced here.
  if has_function_privilege('anon', 'snapshot_season_standings(text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'grant_season_placement_rewards(text,boolean)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'close_season_placements()'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'snapshot_season_standings(text)'::regprocedure, 'EXECUTE') then
    raise exception '0187: a replaced season function is client-callable — was 0185 applied first?';
  end if;
end;
$assert$;
