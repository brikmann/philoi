-- PER-LIFT METRICS (set logging → bench/squat/deadlift leaderboards + versus).
--
-- check_ins only knows a gym lock-in happened (time + photo), so there was no way to compare specific
-- lifts. This adds the missing layer: a lift_exercises reference table and a lift_sets log (weight × reps
-- per set), then teaches the EXISTING metric primitive about it. user_metric() gains a 'lift:' key, so
-- get_metric_leaderboard() and versus_two() (0248) support per-lift boards and head-to-heads with no
-- changes to themselves — e.g. metric 'lift:bench_press:est_1rm' or 'lift:back_squat:volume'.
--
-- UNITS: weight is stored canonical in KILOGRAMS (lb converted on write) so every aggregation and
-- comparison is unit-consistent; the entered unit is kept only for faithful display. The client must
-- pass the unit the user typed.
--
-- CAPTURE (client, not this migration): this is the DATA layer. It is inert until a gym set-logger UI
-- calls log_lift_set() during/after a gym lock-in. No logger = no lift data = empty lift boards.
--
-- Fully additive. Depends on 0248 (user_metric, metric_window_start) + check_ins — APPLY AFTER 0248.
-- LEDGER: this is 0249. Verify prod max applied + ledger first; sequential; no hand-edit; no `db push`;
-- apply in isolation then `supabase migration repair --status applied 0249`. Sync schema.sql after.

begin;

-- ───────────────────────────── lift_exercises (reference) ─────────────────────────────
-- NAMED lift_exercises, not `exercises`: prod already has an undocumented `exercises` table (schema
-- drift, not in schema.sql / migrations — likely another session's unmerged work), and reusing the
-- name made `create table if not exists` a silent no-op that then broke on the insert. lift_exercises
-- is unambiguous and side-steps it.
create table if not exists lift_exercises (
  key          text primary key,
  name         text not null,
  category     text not null check (category in ('push','pull','legs','core','other')),
  is_big_three boolean not null default false
);
alter table lift_exercises enable row level security;
drop policy if exists "lift_exercises: read all" on lift_exercises;
create policy "lift_exercises: read all" on lift_exercises for select using (true);

insert into lift_exercises (key, name, category, is_big_three) values
  ('bench_press','Bench Press','push',true),
  ('back_squat','Back Squat','legs',true),
  ('deadlift','Deadlift','pull',true),
  ('overhead_press','Overhead Press','push',false),
  ('incline_bench_press','Incline Bench Press','push',false),
  ('front_squat','Front Squat','legs',false),
  ('romanian_deadlift','Romanian Deadlift','pull',false),
  ('barbell_row','Barbell Row','pull',false),
  ('pull_up','Pull-Up','pull',false),
  ('lat_pulldown','Lat Pulldown','pull',false),
  ('dumbbell_bench_press','Dumbbell Bench Press','push',false),
  ('dumbbell_shoulder_press','Dumbbell Shoulder Press','push',false),
  ('bicep_curl','Bicep Curl','pull',false),
  ('tricep_extension','Tricep Extension','push',false),
  ('leg_press','Leg Press','legs',false),
  ('leg_curl','Leg Curl','legs',false),
  ('leg_extension','Leg Extension','legs',false),
  ('hip_thrust','Hip Thrust','legs',false),
  ('lunge','Lunge','legs',false),
  ('dip','Dip','push',false),
  ('calf_raise','Calf Raise','legs',false),
  ('plank','Plank','core',false)
on conflict (key) do nothing;

-- ───────────────────────────── lift_sets (the log) ─────────────────────────────
-- One row per working set. volume = weight_kg × reps; est 1RM (Epley) = weight_kg × (1 + reps/30).
-- Soft-deletable (removed_at) to mirror check_ins so an undo doesn't skew history.
create table if not exists lift_sets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  check_in_id  uuid references check_ins (id) on delete set null,  -- optional: the gym lock-in it belongs to
  exercise_key text not null references lift_exercises (key),
  weight_kg    numeric not null check (weight_kg > 0),
  entered_unit text not null default 'kg' check (entered_unit in ('kg','lb')),
  reps         int not null check (reps > 0),
  created_at   timestamptz not null default now(),
  removed_at   timestamptz
);
alter table lift_sets enable row level security;
-- Read own directly; everyone else's lifts are reached only through the security-definer board/versus
-- RPCs (so a stranger's set rows aren't exposed wholesale). Writes go through log_lift_set() only.
drop policy if exists "lift_sets: read own" on lift_sets;
create policy "lift_sets: read own" on lift_sets for select using (user_id = auth.uid());

create index if not exists lift_sets_user_created_idx on lift_sets (user_id, created_at desc);
create index if not exists lift_sets_exercise_idx on lift_sets (exercise_key);

-- ───────────────────────────── log a set ─────────────────────────────
-- Converts lb → kg on write so storage is canonical. Validates the exercise and the numbers.
create or replace function log_lift_set(
  p_exercise_key text,
  p_weight numeric,
  p_unit text,
  p_reps int,
  p_check_in_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kg numeric;
  v_id uuid;
begin
  if not exists (select 1 from lift_exercises where key = p_exercise_key) then
    raise exception 'no such exercise: %', p_exercise_key;
  end if;
  if p_weight is null or p_weight <= 0 or p_reps is null or p_reps < 1 then
    raise exception 'invalid set (weight > 0 and reps >= 1 required)';
  end if;
  v_kg := case when lower(coalesce(p_unit,'kg')) = 'lb' then p_weight * 0.45359237 else p_weight end;

  insert into lift_sets (user_id, check_in_id, exercise_key, weight_kg, entered_unit, reps)
  values (auth.uid(), p_check_in_id, p_exercise_key, v_kg, lower(coalesce(p_unit,'kg')), p_reps)
  returning id into v_id;
  return v_id;
end;
$$;

-- ───────────────────────────── lift aggregation ─────────────────────────────
-- A user's lift stat in a window. p_exercise_key = a key, or 'all' for across every lift.
-- p_agg: volume (Σ weight_kg×reps) · max_weight (kg) · est_1rm (best Epley, kg) · sets · reps.
create or replace function user_lift_metric(p_user_id uuid, p_exercise_key text, p_agg text, p_window text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with w as (select metric_window_start(p_window) as since)
  select case p_agg
    when 'volume' then coalesce((
      select sum(ls.weight_kg * ls.reps) from lift_sets ls, w
      where ls.user_id = p_user_id and ls.removed_at is null and ls.created_at >= w.since
        and (p_exercise_key = 'all' or ls.exercise_key = p_exercise_key)), 0)
    when 'max_weight' then coalesce((
      select max(ls.weight_kg) from lift_sets ls, w
      where ls.user_id = p_user_id and ls.removed_at is null and ls.created_at >= w.since
        and (p_exercise_key = 'all' or ls.exercise_key = p_exercise_key)), 0)
    when 'est_1rm' then coalesce((
      select max(ls.weight_kg * (1 + ls.reps / 30.0)) from lift_sets ls, w
      where ls.user_id = p_user_id and ls.removed_at is null and ls.created_at >= w.since
        and (p_exercise_key = 'all' or ls.exercise_key = p_exercise_key)), 0)
    when 'sets' then coalesce((
      select count(*) from lift_sets ls, w
      where ls.user_id = p_user_id and ls.removed_at is null and ls.created_at >= w.since
        and (p_exercise_key = 'all' or ls.exercise_key = p_exercise_key)), 0)
    when 'reps' then coalesce((
      select sum(ls.reps) from lift_sets ls, w
      where ls.user_id = p_user_id and ls.removed_at is null and ls.created_at >= w.since
        and (p_exercise_key = 'all' or ls.exercise_key = p_exercise_key)), 0)
    else 0
  end;
$$;

-- ───────────── teach user_metric the 'lift:' key (so boards + versus work unchanged) ─────────────
-- Metric key form: 'lift:<exercise_key>:<agg>'  e.g. 'lift:bench_press:est_1rm', 'lift:all:volume'.
-- Rewritten as a searched CASE (0248 used the simple form) so the 'lift:' prefix branch fits; every
-- original branch is preserved verbatim in behaviour.
create or replace function user_metric(p_user_id uuid, p_metric text, p_window text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with w as (select metric_window_start(p_window) as since)
  select case
    when p_metric like 'lift:%' then
      user_lift_metric(p_user_id, split_part(p_metric, ':', 2), split_part(p_metric, ':', 3), p_window)
    when p_metric = 'xp' then
      coalesce((select sum(ci.xp_earned) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.created_at >= w.since), 0)
      + coalesce((select sum(b.amount) from bonus_xp_awards b, w
                where b.user_id = p_user_id and b.created_at >= w.since), 0)
    when p_metric = 'lockin_time' then
      coalesce((select sum(ci.duration_seconds) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.duration_seconds is not null
                  and ci.created_at >= w.since), 0)
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
    when p_metric = 'run_distance' then
      coalesce((select sum(ci.distance_m) from check_ins ci, w
                where ci.user_id = p_user_id and ci.removed_at is null and ci.goal_type = 'run'
                  and ci.distance_m is not null and ci.created_at >= w.since), 0)
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
    else 0
  end;
$$;

grant execute on function log_lift_set(text, numeric, text, int, uuid) to authenticated;
grant execute on function user_lift_metric(uuid, text, text, text) to authenticated;

commit;

-- NOW AVAILABLE through the existing 0248 functions (no new board/versus code needed):
--   get_metric_leaderboard('lift:deadlift:est_1rm', 'my_uni', 'season')   → campus deadlift board
--   get_metric_leaderboard('lift:all:volume', 'friends', 'week')          → who moved the most this week
--   versus_two('user', <A>, 'user', <B>, 'lift:bench_press:est_1rm')      → bench 1RM head-to-head
--   versus_two('program', <A>, 'program', <B>, 'lift:all:volume')         → program vs program total volume
--
-- FOLLOW-UPS (not this migration):
--   * Client: a gym set-logger (exercise picker + weight/unit/reps) that calls log_lift_set during a
--     gym lock-in. Until it ships, lift boards are empty.
--   * Optional: a "Big Three total" agg (bench+squat+deadlift est_1rm) — add as a special exercise_key
--     'big_three' in user_lift_metric when wanted.
--   * est_1rm uses Epley and is only meaningful at low reps; the client should prefer heavy sets for the
--     1RM board, or cap reps considered (e.g. <= 12) if the estimate gets gamed.
