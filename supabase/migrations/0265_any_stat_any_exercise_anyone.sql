-- 0265 . ANY STAT, ANY EXERCISE, ANYONE — the stat library, the fitness board, and head-to-head.
--
-- 0258/0259 built a metric primitive (user_metric) and a board on it, but:
--   * the per-lift half reads lift_sets, which nothing logs to (0 rows). The gym logger the app ships
--     writes workouts / workout_sets / personal_records (0037/0054) against the `exercises` library.
--     So exercise boards here read THAT data, keyed by a normalized exercise name (exercises.slug),
--     because a user-created "Weighted pull-up" is a private row per creator and two creators must
--     still land on one board.
--   * the board had neither board gate: no university_email_verified, no can_see_rank (0170/0217).
--     A private climber was listed on it, and user_metric / user_lift_metric / versus_two were
--     granted to authenticated, so any account could read any other account's numbers by uuid.
--
-- This migration:
--   1. metric_window_start learns '30d'.
--   2. exercises.slug (generated) + exercises.unit (weight | reps | time | distance). For time and
--      distance exercises the logger's reps column carries seconds / metres — log_workout_set's PR
--      rule (higher reps at equal e1rm) already ranks those correctly.
--   3. workout_sets.pr_private / clip_consent_at / pr_status — per-set ranking consent (mock 295):
--      a private set logs but never ranks; a set is VERIFIED when it has a clip AND its owner
--      consented to review; a 'pulled' set (failed review, 0266) counts for nothing.
--   4. user_exercise_metric + user_metric's new keys: the 26-stat library (mock 293).
--   5. metric_catalog — the library itself, with each stat's window, unit, ⚔ flag, and how a ⚔ stat
--      maps onto an existing duel race (xp | lockin_time [+gym/study] | distance), when it can.
--   6. scope 'my_program' — every Heir of the same program_key, across both schools (mock 288).
--   7. get_metric_leaderboard, rebuilt: both board gates, a verified-only filter, and the identity
--      stack columns (university, patron_key, program_abbrev) so a row renders its seal.
--   8. versus(a, b, metric_keys[]) — the compare-anyone H2H (mock 292). Refuses if the caller can't
--      see either side's rank.
--   9. search_exercise_library / create_exercise — the any-exercise picker (mock 294). Community
--      names only surface once two different people have logged them, and new names pass the UGC
--      filter (0242).
--  10. The metric helpers become internal (no client EXECUTE). Every caller is security definer.
--
-- Weights are pounds, as the logger enters them (workout-log.tsx).
--
-- LEDGER: apply this file alone (after 0264), then `supabase migration repair --status applied 0265`.

begin;

-- ──────────────────── 1. the 30-day window ────────────────────
create or replace function metric_window_start(p_window text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case p_window
    when 'week'   then date_trunc('week', now())
    when '30d'    then now() - interval '30 days'
    when 'season' then current_season_start()
    else '-infinity'::timestamptz
  end;
$$;

-- ──────────────────── 2. exercise identity ────────────────────
-- "Weighted Pull-Up", "weighted pull up" and "Weighted  pull-up!" are one board.
create or replace function exercise_slug(p_name text)
returns text
language sql
immutable
as $$
  select trim(both '_' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '_', 'g'));
$$;

alter table exercises add column if not exists slug text generated always as (exercise_slug(name)) stored;
alter table exercises add column if not exists unit text not null default 'weight';
alter table exercises drop constraint if exists exercises_unit_check;
alter table exercises add constraint exercises_unit_check check (unit in ('weight', 'reps', 'time', 'distance'));
create index if not exists exercises_slug_idx on exercises (slug);
comment on column exercises.unit is
  '0265 -- what a set of this exercise measures. weight: weight x reps; reps: bodyweight reps; time: reps holds seconds; distance: reps holds metres.';

-- ──────────────────── 3. per-set ranking consent ────────────────────
alter table workout_sets add column if not exists pr_private boolean not null default false;
alter table workout_sets add column if not exists clip_consent_at timestamptz;
alter table workout_sets add column if not exists pr_status text not null default 'ok';
alter table workout_sets drop constraint if exists workout_sets_pr_status_check;
alter table workout_sets add constraint workout_sets_pr_status_check check (pr_status in ('ok', 'disputed', 'pulled'));
comment on column workout_sets.pr_private is '0265 -- logged, never ranked (mock 295 "Keep private").';
comment on column workout_sets.clip_consent_at is '0265 -- owner consented to moderator review of this set''s clip; with video_key, makes the set verified.';
comment on column workout_sets.pr_status is '0265 -- ok | disputed (a report is open) | pulled (failed review: counts for nothing, clip purged).';

-- Owner-only: rank or hide a set, and consent to clip review.
create or replace function set_workout_set_ranking(p_workout_set_id uuid, p_private boolean, p_consent boolean)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set workout_sets;
begin
  update workout_sets ws
  set pr_private = p_private,
      clip_consent_at = case when p_consent then coalesce(ws.clip_consent_at, now()) else null end
  from workouts w
  where ws.id = p_workout_set_id and ws.workout_id = w.id and w.user_id = auth.uid()
  returning ws.* into v_set;
  if v_set.id is null then
    raise exception 'Not your set.';
  end if;
  return v_set;
end;
$$;

-- ──────────────────── 4. the metrics ────────────────────
-- A user's number on one exercise (by slug). Aggs: e1rm · max_weight · max_reps · volume · sets.
-- Private and pulled sets never count. p_verified_only keeps only clip-on-file, consented sets.
create or replace function user_exercise_metric(
  p_user_id uuid, p_slug text, p_agg text, p_window text, p_verified_only boolean default false
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case p_agg
    when 'e1rm'       then max(gym_e1rm(ws.weight, ws.reps))
    when 'max_weight' then max(ws.weight)
    when 'max_reps'   then max(ws.reps)::numeric
    when 'volume'     then sum(coalesce(ws.weight, 0) * ws.reps)
    when 'sets'       then count(*)::numeric
  end, 0)
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  join workout_exercises we on we.id = ws.workout_exercise_id
  join exercises e on e.id = we.exercise_id
  where w.user_id = p_user_id
    and e.slug = p_slug
    and ws.created_at >= metric_window_start(p_window)
    and not ws.pr_private
    and ws.pr_status <> 'pulled'
    and (not p_verified_only or (ws.video_key is not null and ws.clip_consent_at is not null));
$$;

-- The set behind a user's exercise number — what a board row's "⚑ Dispute this PR" targets. Same
-- filters as user_exercise_metric; for e1rm/max_weight/max_reps it is the set holding the best value.
create or replace function user_exercise_best_set(p_user_id uuid, p_slug text, p_agg text, p_window text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ws.id
  from workout_sets ws
  join workouts w on w.id = ws.workout_id
  join workout_exercises we on we.id = ws.workout_exercise_id
  join exercises e on e.id = we.exercise_id
  where w.user_id = p_user_id
    and e.slug = p_slug
    and p_agg in ('e1rm', 'max_weight', 'max_reps')
    and ws.created_at >= metric_window_start(p_window)
    and not ws.pr_private
    and ws.pr_status <> 'pulled'
  order by case p_agg
             when 'e1rm'       then gym_e1rm(ws.weight, ws.reps)
             when 'max_weight' then coalesce(ws.weight, 0)
             else ws.reps::numeric
           end desc,
           (ws.video_key is not null and ws.clip_consent_at is not null) desc,
           ws.created_at
  limit 1;
$$;

-- 0259's body, every branch kept, plus the library's keys and 'ex:<slug>:<agg>'.
create or replace function user_metric(p_user_id uuid, p_metric text, p_window text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with w as (select metric_window_start(p_window) as since)
  select case
    when p_metric like 'ex:%' then
      user_exercise_metric(p_user_id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window)
    when p_metric like 'lift:%' then
      user_lift_metric(p_user_id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window)
    when p_metric = 'xp' then
      coalesce((select sum(ci.xp_earned) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.created_at >= w.since), 0)
      + coalesce((select sum(b.amount) from bonus_xp_awards b, w
                where b.user_id = p_user_id and b.created_at >= w.since), 0)
    when p_metric = 'season_xp'   then season_score(p_user_id)
    when p_metric = 'lifetime_xp' then universal_score(p_user_id)
    -- The client's rankOrdinal (lib/rank-tiers.ts): tier position × 3 + (3 − stored division), from
    -- the same rank_tier_for_score the boards show. NOT user_rank_state.rank_index (another ladder).
    when p_metric = 'rank_ordinal' then coalesce((
      select (array_position(array['bronze','silver','gold','platinum','diamond','hero','titan','olympian','immortal','primordial'], t.tier) - 1) * 3
             + (3 - t.division)
      from rank_tier_for_score(universal_score(p_user_id)) t), 0)
    when p_metric = 'day_streak'  then coalesce((select p.current_streak from profiles p where p.id = p_user_id), 0)
    when p_metric = 'lockin_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.duration_seconds is not null
                  and ci.created_at >= w.since), 0)
    when p_metric = 'lockin_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.duration_seconds is not null
                  and ci.created_at >= w.since), 0)
    when p_metric = 'longest_session' then
      coalesce((select max(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.created_at >= w.since), 0)
    when p_metric = 'gym_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'gym'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'run_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'study_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'study'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'deep_work_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.category = 'deep_work'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'run_distance' then
      coalesce((select sum(ci.distance_m) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.distance_m is not null and ci.created_at >= w.since), 0)
    when p_metric = 'longest_run' then
      coalesce((select max(ci.distance_m) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.created_at >= w.since), 0)
    when p_metric = 'gym_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'gym'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'run_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'study_sessions' then
      coalesce((select count(*) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'study'
                  and ci.duration_seconds is not null and ci.created_at >= w.since), 0)
    when p_metric = 'gym_volume' then
      coalesce((select sum(coalesce(ws.weight, 0) * ws.reps)
                from workout_sets ws join workouts wo on wo.id = ws.workout_id, w
                where wo.user_id = p_user_id and ws.pr_status <> 'pulled' and ws.created_at >= w.since), 0)
    when p_metric = 'course_challenges_won' then
      coalesce((select count(*) from challenges c, w
                where c.user_id = p_user_id and c.course_id is not null and c.completed_at >= w.since), 0)
    when p_metric = 'challenges_won' then
      coalesce((select count(*) from social_challenges sc, w
                where sc.winner_id = p_user_id and sc.ends_at >= w.since), 0)
    when p_metric = 'h2h_won' then
      coalesce((select count(*) from social_challenges sc, w
                where sc.winner_id = p_user_id and sc.mode = 'h2h' and sc.ends_at >= w.since), 0)
    when p_metric = 'embers_earned' then
      coalesce((select sum(el.delta) from ember_ledger el, w
                where el.user_id = p_user_id and el.delta > 0 and el.reason::text <> 'iap'
                  and el.created_at >= w.since), 0)
    when p_metric = 'pass_xp' then
      coalesce((select fp.pass_xp from forge_pass_state fp where fp.user_id = p_user_id
                order by fp.season_id desc limit 1), 0)
    when p_metric = 'relics_unlocked' then
      coalesce((select count(*) from relic_progress rp where rp.user_id = p_user_id and rp.tier > 0), 0)
    else 0
  end;
$$;

-- The verified half of an exercise metric, for the board's ✓ and its verified-only filter.
create or replace function user_metric_verified(p_user_id uuid, p_metric text, p_window text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when p_metric like 'ex:%' then
    user_exercise_metric(p_user_id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window, true)
  end;
$$;

-- ──────────────────── 5. the stat library ────────────────────
create table if not exists metric_catalog (
  key            text primary key,
  group_key      text not null,
  group_label    text not null,
  label          text not null,
  emoji          text not null,
  metric         text not null,
  metric_window  text not null check (metric_window in ('week', '30d', 'season', 'all')),
  unit           text not null check (unit in ('xp', 'rank', 'days', 'count', 'seconds', 'metres', 'lb', 'embers', 'pass_xp')),
  challengeable  boolean not null,
  duel_metric    text check (duel_metric in ('xp', 'lockin_time', 'distance')),
  duel_goal_type text check (duel_goal_type in ('gym', 'study')),
  fitness        boolean not null default false,
  sort           int not null
);
alter table metric_catalog enable row level security;
drop policy if exists "metric_catalog: read all" on metric_catalog;
create policy "metric_catalog: read all" on metric_catalog for select to authenticated using (true);
comment on table metric_catalog is
  '0265 -- the H2H / fitness-board stat library (mock 293). duel_metric says which existing duel race a challengeable stat can start; null = no duel shape for it yet.';

insert into metric_catalog
  (key, group_key, group_label, label, emoji, metric, metric_window, unit, challengeable, duel_metric, duel_goal_type, fitness, sort)
values
  ('season_xp',             'standing',    'Standing',       'Season XP',             '⬡',  'season_xp',             'all',    'xp',      false, null,          null,    false, 10),
  ('lifetime_xp',           'standing',    'Standing',       'Lifetime XP',           '✦',  'lifetime_xp',           'all',    'xp',      false, null,          null,    false, 20),
  ('rank',                  'standing',    'Standing',       'Rank',                  '🏆', 'rank_ordinal',          'all',    'rank',    false, null,          null,    false, 30),
  ('rank_climb_wk',         'standing',    'Standing',       'Rank climb · wk',       '▲',  'xp',                    'week',   'xp',      true,  'xp',          null,    false, 40),
  ('day_streak',            'standing',    'Standing',       'Day streak',            '🔥', 'day_streak',            'all',    'days',    true,  null,          null,    true,  50),
  ('lockins_30d',           'lockin',      'Lock-in',        'Lock-ins · 30d',        '⏱️', 'lockin_sessions',       '30d',    'count',   true,  null,          null,    false, 110),
  ('lockin_hours_30d',      'lockin',      'Lock-in',        'Lock-in hours · 30d',   '⌛', 'lockin_time',           '30d',    'seconds', true,  'lockin_time', null,    false, 120),
  ('longest_session',       'lockin',      'Lock-in',        'Longest session',       '📅', 'longest_session',       'all',    'seconds', false, null,          null,    false, 130),
  ('study_hours_30d',       'study',       'Study',          'Study hours · 30d',     '📚', 'study_time',            '30d',    'seconds', true,  'lockin_time', 'study', false, 210),
  ('deep_work_hours_30d',   'study',       'Study',          'Deep-work hours · 30d', '🧠', 'deep_work_time',        '30d',    'seconds', true,  null,          null,    false, 220),
  ('study_sessions_30d',    'study',       'Study',          'Study sessions · 30d',  '✍️', 'study_sessions',        '30d',    'count',   true,  null,          null,    false, 230),
  ('course_challenges_won', 'study',       'Study',          'Course challenges won', '🎓', 'course_challenges_won', 'season', 'count',   true,  null,          null,    false, 240),
  ('gym_time_30d',          'gym',         'Gym & strength', 'Gym time · 30d',        '🏋️', 'gym_time',              '30d',    'seconds', true,  'lockin_time', 'gym',   true,  310),
  ('gym_sessions_30d',      'gym',         'Gym & strength', 'Gym sessions · 30d',    '💪', 'gym_sessions',          '30d',    'count',   true,  null,          null,    true,  320),
  ('weekly_volume',         'gym',         'Gym & strength', 'Weekly volume',         '📦', 'gym_volume',            'week',   'lb',      true,  null,          null,    true,  330),
  ('bench_pr',              'gym',         'Gym & strength', 'Bench PR',              '🥇', 'ex:bench_press:e1rm',   'all',    'lb',      true,  null,          null,    true,  340),
  ('squat_pr',              'gym',         'Gym & strength', 'Squat PR',              '🦵', 'ex:squat:e1rm',         'all',    'lb',      true,  null,          null,    true,  350),
  ('deadlift_pr',           'gym',         'Gym & strength', 'Deadlift PR',           '🏗️', 'ex:deadlift:e1rm',      'all',    'lb',      true,  null,          null,    true,  360),
  ('run_distance_30d',      'run',         'Run & cardio',   'Run distance · 30d',    '🏃', 'run_distance',          '30d',    'metres',  true,  'distance',    null,    true,  410),
  ('longest_run',           'run',         'Run & cardio',   'Longest run',           '🛣️', 'longest_run',           'all',    'metres',  true,  null,          null,    true,  420),
  ('run_sessions_30d',      'run',         'Run & cardio',   'Run sessions · 30d',    '👟', 'run_sessions',          '30d',    'count',   true,  null,          null,    true,  430),
  ('challenges_won',        'competition', 'Competition',    'Challenges won',        '⚔️', 'challenges_won',        'all',    'count',   false, null,          null,    false, 510),
  ('h2h_won',               'competition', 'Competition',    'H2Hs won',              '🤝', 'h2h_won',               'all',    'count',   false, null,          null,    false, 520),
  ('embers_earned',         'collection',  'Collection',     'Embers earned',         '🔥', 'embers_earned',         'all',    'embers',  false, null,          null,    false, 610),
  ('forge_pass_level',      'collection',  'Collection',     'Forge Pass level',      '🎟️', 'pass_xp',               'all',    'pass_xp', false, null,          null,    false, 620),
  ('relics_unlocked',       'collection',  'Collection',     'Relics unlocked',       '🏺', 'relics_unlocked',       'all',    'count',   false, null,          null,    false, 630)
on conflict (key) do update set
  group_key = excluded.group_key, group_label = excluded.group_label, label = excluded.label, emoji = excluded.emoji,
  metric = excluded.metric, metric_window = excluded.metric_window, unit = excluded.unit,
  challengeable = excluded.challengeable, duel_metric = excluded.duel_metric, duel_goal_type = excluded.duel_goal_type,
  fitness = excluded.fitness, sort = excluded.sort;

-- ──────────────────── 6. the house scope ────────────────────
-- 0258's body plus 'my_program': every profile whose program shares the caller's program_key, at
-- either school — the house, not one school's slice of it.
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
      when 'my_program' then p.program_id in (
        select pr.id from programs pr
        where pr.program_key = (
          select mine.program_key from profiles me join programs mine on mine.id = me.program_id
          where me.id = auth.uid()
        )
      )
      else true
    end;
$$;

-- ──────────────────── 7. the board ────────────────────
-- Its result type grows and it gains a parameter, so the 0258 signature is dropped first.
drop function if exists get_metric_leaderboard(text, text, text, int);
create function get_metric_leaderboard(
  p_metric        text,
  p_scope         text    default 'global',
  p_window        text    default 'season',
  p_limit         int     default 50,
  p_verified_only boolean default false
)
returns table (
  user_id uuid, handle text, display_name text, avatar_url text, is_pro boolean,
  value numeric, verified boolean, tier text, division int, rank int, is_me boolean,
  university text, patron_key text, program_abbrev text, pr_set_id uuid
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with vals as (
    select p.id, p.handle, p.display_name, p.avatar_url, p.is_pro, p.university, p.program_id,
           user_metric(p.id, p_metric, p_window) as v_all,
           user_metric_verified(p.id, p_metric, p_window) as v_ok
    from profiles p
    join scope_user_ids(p_scope) pool on pool.id = p.id
    where p.university_email_verified          -- the board gate every board has (0062/0253)
      and can_see_rank(auth.uid(), p.id)       -- 0170/0217
  ),
  shown as (
    select vals.*, case when p_verified_only then coalesce(vals.v_ok, 0) else vals.v_all end as v
    from vals
  ),
  ranked as (
    select s.*, row_number() over (order by s.v desc, s.display_name asc)::int as rnk
    from shown s
    where s.v > 0
  )
  select r.id, r.handle, r.display_name, r.avatar_url, r.is_pro,
         r.v,
         case when r.v_ok is null then null else r.v_ok > 0 and r.v_ok >= r.v_all end,
         t.tier, t.division, r.rnk, (r.id = auth.uid()),
         r.university, pr.patron_key, pr.abbrev,
         case when p_metric like 'ex:%' then
           user_exercise_best_set(r.id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window)
         end
  from ranked r
  cross join lateral rank_tier_for_score(universal_score(r.id)) t
  left join programs pr on pr.id = r.program_id
  where p_limit is null or r.rnk <= p_limit or r.id = auth.uid()
  order by r.rnk;
end;
$$;

-- ──────────────────── 8. head-to-head, anyone ────────────────────
-- One row per requested stat, in the order asked. A key is a metric_catalog key, or a raw
-- 'ex:<slug>:<agg>' exercise metric (mock 294's "challenge from Versus"). Up to 12 stats.
create or replace function versus(p_a uuid, p_b uuid, p_metric_keys text[])
returns table (
  metric_key text, label text, emoji text, unit text, a_value numeric, b_value numeric, leader text,
  challengeable boolean, duel_metric text, duel_goal_type text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Pick two different people.';
  end if;
  if not exists (select 1 from profiles where id = p_a and not is_demo and not is_disabled)
     or not exists (select 1 from profiles where id = p_b and not is_demo and not is_disabled) then
    raise exception 'That student isn''t on Philoi any more.';
  end if;
  if not can_see_rank(auth.uid(), p_a) or not can_see_rank(auth.uid(), p_b) then
    raise exception 'They keep their stats private.' using hint = 'rank_private';
  end if;

  return query
  with asked as (
    select k.key, k.ord from unnest(p_metric_keys[1:12]) with ordinality as k(key, ord)
  ),
  resolved as (
    select a.ord, a.key, mc.label, mc.emoji, mc.metric, mc.metric_window, mc.unit, mc.challengeable,
           mc.duel_metric, mc.duel_goal_type
    from asked a join metric_catalog mc on mc.key = a.key
    union all
    select a.ord, a.key,
           coalesce((select e.name from exercises e where e.slug = split_part(a.key, ':', 2)
                     order by (e.created_by is null) desc, e.created_at limit 1), split_part(a.key, ':', 2))
             || case split_part(a.key, ':', 3) when 'e1rm' then ' · est 1RM' when 'max_weight' then ' · max weight'
                                               when 'max_reps' then ' · max reps' when 'volume' then ' · volume' else '' end,
           '🏋️', a.key, 'all',
           case when split_part(a.key, ':', 3) in ('max_reps', 'sets') then 'count' else 'lb' end,
           true, null, null
    from asked a
    where a.key like 'ex:%:%' and not exists (select 1 from metric_catalog mc where mc.key = a.key)
  ),
  scored as (
    select r.*, user_metric(p_a, r.metric, r.metric_window) as av, user_metric(p_b, r.metric, r.metric_window) as bv
    from resolved r
  )
  select s.key, s.label, s.emoji, s.unit, s.av, s.bv,
         case when s.av > s.bv then 'a' when s.bv > s.av then 'b' else 'tie' end,
         s.challengeable, s.duel_metric, s.duel_goal_type
  from scored s
  order by s.ord;
end;
$$;

-- ──────────────────── 9. the exercise library ────────────────────
-- One row per exercise slug the caller may see: built-ins, their own customs, and community names
-- at least two different people have logged (so a one-off typo or a joke name never surfaces).
-- exercise_id is the row the caller can log against (a built-in or their own), or null.
create or replace function search_exercise_library(p_query text default null, p_limit int default 40)
returns table (slug text, name text, muscle_group text, unit text, lifters bigint, exercise_id uuid, is_builtin boolean)
language sql
stable
security definer
set search_path = public
as $$
  with usage as (
    select e.slug, count(distinct w.user_id) as lifters
    from workout_sets ws
    join workouts w on w.id = ws.workout_id
    join workout_exercises we on we.id = ws.workout_exercise_id
    join exercises e on e.id = we.exercise_id
    where not ws.pr_private
    group by e.slug
  ),
  lib as (
    select e.slug,
           (array_agg(e.name order by (e.created_by is null) desc, (e.created_by = auth.uid()) desc, e.created_at))[1] as name,
           (array_agg(e.muscle_group order by (e.created_by is null) desc, e.created_at))[1] as muscle_group,
           (array_agg(e.unit order by (e.created_by is null) desc, e.created_at))[1] as unit,
           (array_agg(e.id order by (e.created_by is null) desc, e.created_at)
              filter (where e.created_by is null or e.created_by = auth.uid()))[1] as exercise_id,
           bool_or(e.created_by is null) as is_builtin,
           bool_or(e.created_by = auth.uid()) as is_mine
    from exercises e
    where e.slug <> ''
    group by e.slug
  )
  select l.slug, l.name, l.muscle_group, l.unit, coalesce(u.lifters, 0), l.exercise_id, l.is_builtin
  from lib l
  left join usage u on u.slug = l.slug
  where (l.is_builtin or l.is_mine or coalesce(u.lifters, 0) >= 2)
    and (p_query is null or btrim(p_query) = '' or l.name ilike '%' || btrim(p_query) || '%'
         or l.slug like '%' || exercise_slug(p_query) || '%')
  order by coalesce(u.lifters, 0) desc, l.name
  limit least(coalesce(p_limit, 40), 100);
$$;

-- Create (or find) an exercise by name. De-dupes against built-ins and the caller's own customs by
-- slug, so "bench  press" returns the built-in Bench press rather than a second row.
create or replace function create_exercise(p_name text, p_muscle_group text default null, p_unit text default 'weight')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 or exercise_slug(v_name) = '' then
    raise exception 'Give the exercise a name between 2 and 40 characters.';
  end if;
  if coalesce(p_unit, 'weight') not in ('weight', 'reps', 'time', 'distance') then
    raise exception 'Unknown unit.';
  end if;
  if p_muscle_group is not null and p_muscle_group not in ('arms', 'back', 'chest', 'core', 'legs', 'shoulders', 'full_body', 'cardio') then
    raise exception 'Unknown muscle group.';
  end if;

  select e.id into v_id from exercises e
  where e.slug = exercise_slug(v_name) and (e.created_by is null or e.created_by = auth.uid())
  order by (e.created_by is null) desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  perform ugc_assert_clean(v_name);
  insert into exercises (name, muscle_group, created_by, unit)
  values (v_name, p_muscle_group, auth.uid(), coalesce(p_unit, 'weight'))
  returning id into v_id;
  return v_id;
end;
$$;

-- ──────────────────── 10. grants ────────────────────
revoke all on function metric_window_start(text) from public, anon, authenticated;
revoke all on function user_metric(uuid, text, text) from public, anon, authenticated;
revoke all on function user_lift_metric(uuid, text, text, text) from public, anon, authenticated;
revoke all on function user_exercise_metric(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function user_metric_verified(uuid, text, text) from public, anon, authenticated;
revoke all on function user_exercise_best_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function scope_user_ids(text) from public, anon, authenticated;
revoke all on function versus_two(text, text, text, text, text, text, text) from public, anon, authenticated;

revoke all on function get_metric_leaderboard(text, text, text, int, boolean) from public, anon;
revoke all on function versus(uuid, uuid, text[]) from public, anon;
revoke all on function search_exercise_library(text, int) from public, anon;
revoke all on function create_exercise(text, text, text) from public, anon;
revoke all on function set_workout_set_ranking(uuid, boolean, boolean) from public, anon;
grant execute on function get_metric_leaderboard(text, text, text, int, boolean) to authenticated;
grant execute on function versus(uuid, uuid, text[]) to authenticated;
grant execute on function search_exercise_library(text, int) to authenticated;
grant execute on function create_exercise(text, text, text) to authenticated;
grant execute on function set_workout_set_ranking(uuid, boolean, boolean) to authenticated;

-- ──────────────────── assertions ────────────────────
do $assert$
declare
  v_n int;
  v_missing text;
begin
  select count(*) into v_n from metric_catalog;
  if v_n <> 26 then raise exception '0265: expected 26 stats in the library, got %', v_n; end if;

  -- The three preset lift boards must point at real built-in exercises, or they're always empty.
  select string_agg(split_part(mc.metric, ':', 2), ', ') into v_missing
  from metric_catalog mc
  where mc.metric like 'ex:%'
    and not exists (select 1 from exercises e where e.created_by is null and e.slug = split_part(mc.metric, ':', 2));
  if v_missing is not null then raise exception '0265: preset lift boards with no built-in exercise: %', v_missing; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_metric_leaderboard';
  if v_n <> 1 then raise exception '0265: expected one get_metric_leaderboard, got %', v_n; end if;

  if has_function_privilege('authenticated', 'public.user_metric(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.user_metric(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.versus_two(text, text, text, text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.versus(uuid, uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.versus(uuid, uuid, text[])', 'execute') then
    raise exception '0265: metric grants are wrong';
  end if;
end;
$assert$;

commit;
