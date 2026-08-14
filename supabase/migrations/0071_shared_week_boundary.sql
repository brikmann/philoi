-- One week boundary, server side (punchlist 8 §5). The client half is src/lib/time/week.ts and the
-- two MUST agree — `week_key()` here and `weekKey()` there write into the same dedupe column.
--
-- Postgres' `date_trunc('week', …)` is ISO, which means MONDAY. The shop was flooring
-- `Date.now() / WEEK_MS` client-side, which anchors to the Unix epoch — a THURSDAY. The Forge Pass
-- counted weeks from the season start, so it rolled on whatever weekday that happened to be. Three
-- "weekly" resets, three weekdays. Everything below moves to Sunday 00:00 UTC.
--
-- Why UTC and not the session timezone: weekly challenges are shared between friends who may be in
-- different timezones. A local-midnight boundary would close the same shared window at a different
-- instant for each member, so the standings would depend on which member you asked.

begin;


-- ───────────────────────────────── the helpers ─────────────────────────────────

-- Sunday 00:00 UTC of the week containing p_ts. date_trunc('week') lands on Monday, so shift the
-- input forward a day before truncating and pull the result back a day after — Monday of the
-- shifted week is Sunday of the real one.
create or replace function week_start(p_ts timestamptz default now())
returns timestamptz
language sql
immutable
as $$
  select ((date_trunc('week', (p_ts at time zone 'UTC') + interval '1 day') - interval '1 day')
          at time zone 'UTC');
$$;

-- Whole weeks since Sun 4 Jan 1970 00:00 UTC — the first Sunday after the epoch (a Thursday).
-- 259200 seconds = those 3 days; 604800 = one week. This is the exact integer that
-- `weekIndex()` computes client-side, which is what lets week_key() and weekKey() agree.
create or replace function week_index(p_ts timestamptz default now())
returns bigint
language sql
immutable
as $$
  select floor((extract(epoch from p_ts) - 259200) / 604800)::bigint;
$$;

-- "W2953" — the once-per-week dedupe key for pass_xp_ledger.period_key. Never displayed; its only
-- job is to be identical to what the client computes for the same instant.
create or replace function week_key(p_ts timestamptz default now())
returns text
language sql
immutable
as $$
  select 'W' || week_index(p_ts)::text;
$$;

comment on function week_start(timestamptz) is
  'Sunday 00:00 UTC week boundary. Mirrors weekStart() in src/lib/time/week.ts — change both together.';
comment on function week_key(timestamptz) is
  'Weekly dedupe key ("W2953"). Mirrors weekKey() in src/lib/time/week.ts — change both together.';


-- ─────────────────────── migrate the weekly windows in the economy engine ───────────────────────
--
-- Both functions below are re-emitted verbatim from 0065 apart from the week boundary:
--   date_trunc('week', now())        → week_start()
--   to_char(now(), 'IYYY-"W"IW')     → week_key()
-- Signatures are unchanged, so `create or replace` is safe here (a changed signature would need a
-- drop first — Postgres would otherwise leave the old overload in place alongside the new one).

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
  select count(*),
         bool_or(extract(epoch from (s.last_confirmed_at - s.started_at)) >= 5400),
         bool_or(g.type ilike '%gym%'),
         array_agg(distinct g.type)
    into v_today_count, v_today_deep, v_today_gym, v_today_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

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
  select array_agg(distinct g.type) into v_yesterday_types
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
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
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = p_user
    and s.status = 'completed'
    and s.started_at >= week_start()
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

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


-- The progress counters the achievement list renders ("6.5 / 10 h"). These must scan the SAME
-- window evaluate_pass_achievements credits from, or the bar would fill against Monday's week while
-- the reward paid out on Sunday's.
create or replace function get_pass_achievement_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
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

  select count(*) into v_today
  from lock_in_sessions s
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= date_trunc('day', now())
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  select count(distinct s.started_at::date),
         coalesce(sum(extract(epoch from (s.last_confirmed_at - s.started_at))), 0),
         count(*) filter (where g.type ilike '%gym%')
    into v_week_days, v_week_seconds, v_week_gym
  from lock_in_sessions s
  join goals g on g.id = s.goal_id
  where s.user_id = v_user and s.status = 'completed'
    and s.started_at >= week_start()
    and extract(epoch from (s.last_confirmed_at - s.started_at)) >= v_min;

  return jsonb_build_object(
    'daily_three_lock_ins', coalesce(v_today, 0),
    'weekly_six_active_days', coalesce(v_week_days, 0),
    'weekly_ten_hours', round(coalesce(v_week_seconds, 0) / 3600.0, 1),
    'weekly_five_gym', coalesce(v_week_gym, 0)
  );
end;
$$;


-- ─────────────────────────── new challenges open on the same Sunday ───────────────────────────
--
-- `challenges.period_start` defaulted to `date_trunc('week', now())::date` — Monday, in the DB
-- session timezone. Only the DEFAULT moves here; existing rows keep the period_start they were
-- created with, because rewriting them would retroactively widen or narrow the window that
-- sync_challenge_from_lock_ins and the Strava/Whoop syncs have already credited against, and could
-- double-count activity that fell in the shifted days.
--
-- NOTE: this changes when a challenge's window OPENS. It does not make challenges roll over — see
-- task #89; nothing in this schema ever advances period_start after insert.
-- Read back through UTC before casting to date: week_start() returns the *instant* of Sunday 00:00
-- UTC, and a bare ::date renders that instant in the session timezone — which in anything west of
-- UTC is the Saturday.
alter table challenges
  alter column period_start set default (week_start() at time zone 'UTC')::date;

commit;
