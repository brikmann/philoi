-- THE VERSUS ENGINE + FITNESS LEADERBOARDS.
--
-- Two things, on one metric primitive:
--   1. Fitness leaderboards — rank individuals by a gym / run / study metric (time, distance, sessions,
--      XP) within a scope (friends / my uni / global) over a window (week / season / all-time).
--   2. The Versus engine — "compare anything vs anything": pick Side A and Side B (a person, a program,
--      or a school) and a metric + window, get the head-to-head. Program-vs-program and school-vs-school
--      rivalry both fall out of it. Builds on programs.program_id (0247) and the seasonal window (0246).
--
-- METRICS ARE SCOPED TO WHAT check_ins ACTUALLY STORES: xp_earned, duration_seconds, distance_m, and
-- goal_type (gym/run/study). So the metric set is XP, lock-in time, per-discipline time, run distance,
-- and session counts. Per-LIFT numbers (bench/squat/deadlift) are NOT tracked granularly yet — that
-- needs a set-logging schema (future), so they are intentionally absent here rather than faked.
--
-- Fully additive: new read-only functions only, no table/column changes. The live app never calls them.
--
-- LEDGER DISCIPLINE: this is 0248 (0243–0247 pending). Verify the prod max applied migration + the
-- schema_migrations ledger FIRST; number sequentially; never hand-edit the ledger; do NOT `db push`.
-- Apply in isolation, then `supabase migration repair --status applied 0248`. Sync schema.sql after.

begin;

-- ───────────────────────────── window + metric primitive ─────────────────────────────
-- Window start for 'week' | 'season' | 'all'. Season reuses current_season_start() (0246); 'all' is
-- -infinity so the same code path serves lifetime.
create or replace function metric_window_start(p_window text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case p_window
    when 'week'   then date_trunc('week', now())
    when 'season' then current_season_start()
    else '-infinity'::timestamptz
  end;
$$;

-- One user's total for a metric in a window. The single source of truth both the fitness boards and
-- the Versus engine aggregate. Unknown metric -> 0 (callers validate the picker set). XP folds in
-- bonus_xp_awards the same way season_score/universal_score do, so it matches the main board.
create or replace function user_metric(p_user_id uuid, p_metric text, p_window text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with w as (select metric_window_start(p_window) as since)
  select case p_metric
    when 'xp' then
      coalesce((select sum(ci.xp_earned) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.created_at >= w.since), 0)
      + coalesce((select sum(b.amount) from bonus_xp_awards b, w
                where b.user_id = p_user_id and b.created_at >= w.since), 0)
    when 'lockin_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.duration_seconds is not null
                  and ci.created_at >= w.since), 0)
    when 'gym_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'gym'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when 'run_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when 'study_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'study'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when 'run_distance' then
      coalesce((select sum(ci.distance_m) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.distance_m is not null and ci.created_at >= w.since), 0)
    when 'gym_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'gym'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when 'run_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when 'study_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'study'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    else 0
  end;
$$;

-- Internal: the user pool for a scope. 'friends' = caller + accepted friends; 'my_uni' = caller's
-- university; 'global' = everyone. Always excludes demo/disabled. Returns a set of profile ids.
create or replace function scope_user_ids(p_scope text)
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from profiles p
  where not p.is_demo and not p.is_disabled
    and case p_scope
      when 'friends' then (
        p.id = auth.uid() or exists (
          select 1 from friend_requests fr
          where fr.status = 'accepted'
            and ((fr.requester_id = auth.uid() and fr.recipient_id = p.id)
              or (fr.requester_id = p.id and fr.recipient_id = auth.uid()))
        )
      )
      when 'my_uni' then p.university = (select university from profiles where id = auth.uid())
      else true
    end;
$$;

-- ───────────────────────────── fitness (and overall) leaderboards ─────────────────────────────
-- Rank individuals by any metric, in a scope + window. p_metric is a direct key from user_metric
-- (e.g. 'run_distance', 'gym_time', 'study_sessions', 'xp', 'lockin_time'). Your own row is pinned.
create or replace function get_metric_leaderboard(
  p_metric text,
  p_scope  text default 'global',
  p_window text default 'season',
  p_limit  int  default 50
)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  value numeric, tier text, division int, rank int, is_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with pool as (select id from scope_user_ids(p_scope)),
  ranked as (
    select
      p.id as user_id, p.handle, p.display_name, p.avatar_url, p.is_pro,
      user_metric(p.id, p_metric, p_window) as value,
      t.tier, t.division,
      row_number() over (order by user_metric(p.id, p_metric, p_window) desc, p.display_name asc)::int as rank
    from profiles p
    join pool on pool.id = p.id
    cross join lateral rank_tier_for_score(universal_score(p.id)) t
  )
  select r.user_id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.value, r.tier, r.division, r.rank, (r.user_id = auth.uid()) as is_me
  from ranked r
  where (r.rank <= p_limit or r.user_id = auth.uid()) and r.value > 0
  order by r.rank;
end;
$$;

-- ───────────────────────────── the Versus engine ─────────────────────────────
-- Compare two sides head-to-head. Each side is (type, id):
--   type 'user'    → id = a profile uuid        (1v1 duel)
--   type 'program' → id = a programs.id uuid     (program vs program, same or cross-school)
--   type 'school'  → id = a university name text (school vs school)
-- p_scope narrows the user pool for GROUP sides (program/school); it's ignored for 'user' sides.
-- Returns one row per side with its total, member count, and average, so the UI can render either
-- the raw total (fair for same-size programs) or the per-member average (fair across sizes).
create or replace function versus_two(
  p_a_type text, p_a_id text,
  p_b_type text, p_b_id text,
  p_metric text,
  p_window text default 'season',
  p_scope  text default 'global'
)
returns table (
  side text, entity_type text, entity_id text, label text,
  total numeric, member_count bigint, avg_value numeric
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with sides as (
    select 'A'::text as side, p_a_type as etype, p_a_id as eid
    union all
    select 'B'::text, p_b_type, p_b_id
  )
  select
    s.side,
    s.etype,
    s.eid,
    case s.etype
      when 'user'    then (select display_name from profiles where id = s.eid::uuid)
      when 'program' then (select name from programs where id = s.eid::uuid)
      else s.eid  -- school: the university name is the label
    end as label,
    case s.etype
      when 'user' then user_metric(s.eid::uuid, p_metric, p_window)
      else (
        select coalesce(sum(user_metric(p.id, p_metric, p_window)), 0)
        from profiles p
        join scope_user_ids(p_scope) pool on pool.id = p.id
        where (s.etype = 'program' and p.program_id = s.eid::uuid)
           or (s.etype = 'school'  and p.university = s.eid)
      )
    end as total,
    case s.etype
      when 'user' then 1::bigint
      else (
        select count(*)
        from profiles p
        join scope_user_ids(p_scope) pool on pool.id = p.id
        where (s.etype = 'program' and p.program_id = s.eid::uuid)
           or (s.etype = 'school'  and p.university = s.eid)
      )
    end as member_count,
    case s.etype
      when 'user' then user_metric(s.eid::uuid, p_metric, p_window)
      else (
        select case when count(*) = 0 then 0 else coalesce(sum(user_metric(p.id, p_metric, p_window)), 0) / count(*) end
        from profiles p
        join scope_user_ids(p_scope) pool on pool.id = p.id
        where (s.etype = 'program' and p.program_id = s.eid::uuid)
           or (s.etype = 'school'  and p.university = s.eid)
      )
    end as avg_value
  from sides s;
end;
$$;

grant execute on function metric_window_start(text) to authenticated;
grant execute on function user_metric(uuid, text, text) to authenticated;
grant execute on function scope_user_ids(text) to authenticated;
grant execute on function get_metric_leaderboard(text, text, text, int) to authenticated;
grant execute on function versus_two(text, text, text, text, text, text, text) to authenticated;

commit;

-- METRIC KEYS (for the client picker):
--   xp · lockin_time · gym_time · run_time · study_time · run_distance (metres) ·
--   gym_sessions · run_sessions · study_sessions
-- WINDOWS: week · season · all        SCOPES: friends · my_uni · global
--
-- FOLLOW-UPS (not this migration):
--   * Per-lift metrics (bench/squat/deadlift volume) need a set-logging schema — not tracked yet.
--   * Performance: user_metric scans check_ins per call, and the group/leaderboard RPCs call it per
--     user. Fine at launch scale; if a board gets slow, add a per-user-per-day rollup table and point
--     user_metric at it (same signature, so no caller changes).
--   * get_university_totals (0246) stays as the Uni-vs-Uni preset; versus_two('school',…,'school',…)
--     is the generalized form — fold the UI onto one of them.
