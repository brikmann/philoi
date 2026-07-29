-- Lean gym tracker (PHILOI_UI_SPEC.md §23, design-mocks/23 + 24). The tracker is deliberately
-- NOT trying to out-feature Hevy/Strong — the moat is the social/accountability layer, so this
-- is the smallest data model that supports: a routine preloaded from memory, an in-session
-- weight×reps log, an automatic PR flag, and a summary that can be posted to a campfire.
--
-- Relationship to migration 0033's check_in_workout_sets: that table stays exactly as it is and
-- remains the ONE summary shape everything downstream reads (the anti-farming quality floor
-- check_in_qualifies_for_challenge, the done-screen recap, the campfire card). The live tables
-- below are the detailed in-session log; stop_lock_in_session() rolls them up into
-- check_in_workout_sets at the end, so nothing downstream needed rewriting.
--
-- Deferred to phase 2 (§23): per-set video, history charts, plate math, rest timers,
-- supersets/RPE, per-lift PR leaderboards.

-- ───────────────────────────── exercise library ─────────────────────────────
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text,
  -- null = built-in (everyone sees it); set = that user's own custom lift, private to them.
  created_by uuid references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Case-insensitive uniqueness, scoped separately for built-ins vs. a user's own additions —
-- so "bench press" can't be seeded twice, and a user can't create two of their own custom
-- lifts with the same name, but they CAN shadow a built-in name if they want to.
create unique index if not exists exercises_builtin_name_idx on exercises (lower(name)) where created_by is null;
create unique index if not exists exercises_custom_name_idx on exercises (created_by, lower(name)) where created_by is not null;
create index if not exists exercises_muscle_idx on exercises (muscle_group);

alter table exercises enable row level security;

drop policy if exists "exercises: read builtin or own" on exercises;
create policy "exercises: read builtin or own" on exercises for select using (
  created_by is null or created_by = auth.uid()
);

drop policy if exists "exercises: insert own" on exercises;
create policy "exercises: insert own" on exercises for insert with check (created_by = auth.uid());

drop policy if exists "exercises: delete own" on exercises;
create policy "exercises: delete own" on exercises for delete using (created_by = auth.uid());

-- A starter library that covers the lifts a normal gym session is actually made of. Idempotent
-- (re-runnable) via the not-exists guard rather than ON CONFLICT, since the uniqueness index
-- above is partial.
insert into exercises (name, muscle_group)
select v.name, v.muscle_group
from (values
  ('Bench press', 'chest'),
  ('Incline bench press', 'chest'),
  ('Incline dumbbell press', 'chest'),
  ('Dumbbell bench press', 'chest'),
  ('Chest fly', 'chest'),
  ('Cable crossover', 'chest'),
  ('Push-up', 'chest'),
  ('Dip', 'chest'),
  ('Overhead press', 'shoulders'),
  ('Dumbbell shoulder press', 'shoulders'),
  ('Arnold press', 'shoulders'),
  ('Lateral raise', 'shoulders'),
  ('Front raise', 'shoulders'),
  ('Rear delt fly', 'shoulders'),
  ('Face pull', 'shoulders'),
  ('Shrug', 'shoulders'),
  ('Deadlift', 'back'),
  ('Romanian deadlift', 'back'),
  ('Barbell row', 'back'),
  ('Dumbbell row', 'back'),
  ('Seated cable row', 'back'),
  ('Lat pulldown', 'back'),
  ('Pull-up', 'back'),
  ('Chin-up', 'back'),
  ('T-bar row', 'back'),
  ('Back extension', 'back'),
  ('Squat', 'legs'),
  ('Front squat', 'legs'),
  ('Hack squat', 'legs'),
  ('Leg press', 'legs'),
  ('Bulgarian split squat', 'legs'),
  ('Lunge', 'legs'),
  ('Leg extension', 'legs'),
  ('Leg curl', 'legs'),
  ('Hip thrust', 'legs'),
  ('Calf raise', 'legs'),
  ('Barbell curl', 'arms'),
  ('Dumbbell curl', 'arms'),
  ('Hammer curl', 'arms'),
  ('Preacher curl', 'arms'),
  ('Cable curl', 'arms'),
  ('Triceps pushdown', 'arms'),
  ('Skullcrusher', 'arms'),
  ('Overhead triceps extension', 'arms'),
  ('Close-grip bench press', 'arms'),
  ('Plank', 'core'),
  ('Hanging leg raise', 'core'),
  ('Cable crunch', 'core'),
  ('Russian twist', 'core'),
  ('Ab wheel rollout', 'core')
) as v (name, muscle_group)
where not exists (
  select 1 from exercises e where e.created_by is null and lower(e.name) = lower(v.name)
);

-- ───────────────────────────── routines (built from memory) ─────────────────────────────
-- §23: "Routines build from memory — any logged workout can be saved as a routine." A routine is
-- just an ordered list of lifts; targets are never stored on it, because targets come from what
-- you actually lifted last time (see get_active_workout below).
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists routines_user_idx on routines (user_id, last_used_at desc nulls last);

create table if not exists routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  position int not null default 0,
  created_at timestamptz not null default now()
);
-- Deliberately NOT unique on (routine_id, position): reordering rewrites positions in place and
-- a unique constraint would need deferring to survive the intermediate states.
create index if not exists routine_exercises_routine_idx on routine_exercises (routine_id, position);

alter table routines enable row level security;
alter table routine_exercises enable row level security;

drop policy if exists "routines: own" on routines;
create policy "routines: own" on routines for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "routine_exercises: own" on routine_exercises;
create policy "routine_exercises: own" on routine_exercises for all using (
  exists (select 1 from routines r where r.id = routine_exercises.routine_id and r.user_id = auth.uid())
) with check (
  exists (select 1 from routines r where r.id = routine_exercises.routine_id and r.user_id = auth.uid())
);

-- ───────────────────────────── the live workout ─────────────────────────────
-- One workout per gym lock-in session. Unlike 0033's batch-on-stop log, this is persisted
-- set-by-set as it happens — a phone dying mid-session in a gym is a real scenario, and the PR
-- flag has to be decided at the moment the set is banked (that's the dopamine beat), not
-- retroactively at Finish.
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  lock_in_session_id uuid references lock_in_sessions (id) on delete set null,
  -- Set by stop_lock_in_session() at Finish — this is what makes the workout part of the
  -- lock-in data on the done screen (§13).
  check_in_id uuid references check_ins (id) on delete cascade,
  routine_id uuid references routines (id) on delete set null,
  -- Snapshot: the routine can be renamed or deleted later, the workout's own history shouldn't move.
  routine_name text,
  energy text not null default 'same' check (energy in ('light', 'same', 'dialed')),
  -- "Honest brag" (§23 rule 2) — decided at Finish from what was actually LOGGED, never from the
  -- mood that was picked. See stop_lock_in_session().
  brag_earned boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
-- Mirrors lock_in_sessions' own one-active-per-user rule, so the client never has to
-- disambiguate which workout it's writing to.
create unique index if not exists workouts_one_active_per_user on workouts (user_id) where ended_at is null;
create index if not exists workouts_check_in_idx on workouts (check_in_id);
create index if not exists workouts_user_started_idx on workouts (user_id, started_at desc);

create table if not exists workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete restrict,
  -- Snapshot of the name at log time, same reasoning as routine_name.
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists workout_exercises_workout_idx on workout_exercises (workout_id, position);

create table if not exists workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts (id) on delete cascade,
  workout_exercise_id uuid not null references workout_exercises (id) on delete cascade,
  set_index int not null,
  -- Null for bodyweight work (push-ups, pull-ups, plank) — reps alone are the record there.
  weight numeric check (weight >= 0),
  reps int not null check (reps > 0),
  -- Historical: "this set was a personal best AT THE MOMENT it was banked." Never rewritten
  -- later, which is what makes the in-session PR badge honest.
  is_pr boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists workout_sets_exercise_idx on workout_sets (workout_exercise_id, set_index);
create index if not exists workout_sets_workout_idx on workout_sets (workout_id);

create table if not exists personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  weight numeric not null default 0,
  reps int not null,
  -- The ranking metric (see gym_e1rm) — stored so the PR check is one indexed lookup per set
  -- rather than a scan over the user's whole lifting history.
  e1rm numeric not null,
  workout_set_id uuid references workout_sets (id) on delete set null,
  achieved_at timestamptz not null default now(),
  unique (user_id, exercise_id)
);

alter table workouts enable row level security;
alter table workout_exercises enable row level security;
alter table workout_sets enable row level security;
alter table personal_records enable row level security;

-- Same visibility rule as check_in_workout_sets (0033): yours, your circle-mates', or admin —
-- so a posted campfire card can show someone else's lifts and PRs.
drop policy if exists "workouts: read if circle-mate" on workouts;
create policy "workouts: read if circle-mate" on workouts for select using (
  user_id = auth.uid() or is_circle_mate_of(user_id) or is_admin()
);

drop policy if exists "workout_exercises: read via workout" on workout_exercises;
create policy "workout_exercises: read via workout" on workout_exercises for select using (
  exists (
    select 1 from workouts w
    where w.id = workout_exercises.workout_id
      and (w.user_id = auth.uid() or is_circle_mate_of(w.user_id) or is_admin())
  )
);

drop policy if exists "workout_sets: read via workout" on workout_sets;
create policy "workout_sets: read via workout" on workout_sets for select using (
  exists (
    select 1 from workouts w
    where w.id = workout_sets.workout_id
      and (w.user_id = auth.uid() or is_circle_mate_of(w.user_id) or is_admin())
  )
);

-- PRs are private for now — per-lift PR leaderboards are explicitly phase 2 (§23).
drop policy if exists "personal_records: own" on personal_records;
create policy "personal_records: own" on personal_records for select using (user_id = auth.uid());

-- No insert/update/delete policies on any of the four: every write goes through the
-- security-definer RPCs below, the same trusted-write pattern as check_in_photos /
-- check_in_workout_sets. A client that could INSERT workout_sets directly could also hand
-- itself a PR.

-- ───────────────────────────── PR maths ─────────────────────────────
-- Epley estimated 1RM. Ranking by e1RM rather than raw weight is what makes "same weight, one
-- more rep" count as progress — the thing that actually happens most weeks. For bodyweight work
-- (weight null) this collapses to 0 for every set, so the tie-break on reps below becomes a pure
-- rep comparison, which is the correct read for push-ups/pull-ups.
create or replace function gym_e1rm(p_weight numeric, p_reps int)
returns numeric
language sql
immutable
as $$
  select round(coalesce(p_weight, 0) * (1 + p_reps / 30.0), 2);
$$;

-- Rebuilds a lift's stored best from the sets that still exist. Called after a set is deleted or
-- an exercise is removed/replaced mid-session, so an accidental mistyped 500lb set can't leave a
-- permanent phantom PR behind. Historical workout_sets.is_pr flags are intentionally NOT
-- rewritten — they record what was true when the set was banked.
create or replace function gym_recompute_pr(p_user_id uuid, p_exercise_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_best record;
begin
  select ws.id, ws.weight, ws.reps, gym_e1rm(ws.weight, ws.reps) as e1rm, ws.created_at
  into v_best
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where w.user_id = p_user_id and we.exercise_id = p_exercise_id
  order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc, ws.created_at asc
  limit 1;

  if v_best.id is null then
    delete from personal_records where user_id = p_user_id and exercise_id = p_exercise_id;
    return;
  end if;

  insert into personal_records (user_id, exercise_id, weight, reps, e1rm, workout_set_id, achieved_at)
  values (p_user_id, p_exercise_id, coalesce(v_best.weight, 0), v_best.reps, v_best.e1rm, v_best.id, v_best.created_at)
  on conflict (user_id, exercise_id) do update
    set weight = excluded.weight,
        reps = excluded.reps,
        e1rm = excluded.e1rm,
        workout_set_id = excluded.workout_set_id,
        achieved_at = excluded.achieved_at;
end;
$$;

-- ───────────────────────────── routine management ─────────────────────────────
create or replace function save_routine(p_name text, p_exercise_ids uuid[], p_routine_id uuid default null)
returns routines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routine routines;
  i int;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A routine needs a name.';
  end if;
  if p_exercise_ids is null or array_length(p_exercise_ids, 1) is null then
    raise exception 'A routine needs at least one exercise.';
  end if;

  if p_routine_id is not null then
    update routines set name = btrim(p_name), updated_at = now()
    where id = p_routine_id and user_id = auth.uid()
    returning * into v_routine;
    if v_routine.id is null then
      raise exception 'Routine not found.';
    end if;
    delete from routine_exercises where routine_id = v_routine.id;
  else
    insert into routines (user_id, name) values (auth.uid(), btrim(p_name)) returning * into v_routine;
  end if;

  -- Positions come from array order, and only exercises the caller can actually see (built-in or
  -- their own) are accepted — this is a security-definer function, so RLS isn't doing it for us.
  for i in 1 .. array_length(p_exercise_ids, 1) loop
    insert into routine_exercises (routine_id, exercise_id, position)
    select v_routine.id, e.id, i - 1
    from exercises e
    where e.id = p_exercise_ids[i] and (e.created_by is null or e.created_by = auth.uid());
  end loop;

  return v_routine;
end;
$$;

-- "Any logged workout can be saved as a routine" (§23) — offered on the done screen after a
-- freestyle session, which is how a routine library builds itself without anyone sitting down to
-- author one.
create or replace function save_workout_as_routine(p_workout_id uuid, p_name text)
returns routines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(we.exercise_id order by we.position)
  into v_ids
  from workout_exercises we
  join workouts w on w.id = we.workout_id
  where we.workout_id = p_workout_id and w.user_id = auth.uid();

  if v_ids is null then
    raise exception 'That workout has no exercises to save.';
  end if;

  return save_routine(p_name, v_ids, null);
end;
$$;

-- ───────────────────────────── session lifecycle ─────────────────────────────
create or replace function start_workout(
  p_session_id uuid,
  p_routine_id uuid default null,   -- null = Freestyle (log exercises as you go)
  p_energy text default 'same'
)
returns workouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_workout workouts;
  v_routine routines;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active';
  if v_session.id is null then
    raise exception 'No active lock-in session to log a workout against.';
  end if;

  -- Idempotent: reopening the app mid-session calls this again and must get the SAME workout
  -- back, not a second one (and not an error).
  select * into v_workout from workouts
  where lock_in_session_id = p_session_id and user_id = auth.uid() and ended_at is null;
  if v_workout.id is not null then
    return v_workout;
  end if;

  -- Close anything orphaned by an abandoned session — otherwise the one-active-per-user index
  -- would permanently wedge the user out of ever starting another workout.
  update workouts set ended_at = now() where user_id = auth.uid() and ended_at is null;

  if p_routine_id is not null then
    select * into v_routine from routines where id = p_routine_id and user_id = auth.uid();
    if v_routine.id is null then
      raise exception 'Routine not found.';
    end if;
  end if;

  insert into workouts (user_id, lock_in_session_id, routine_id, routine_name, energy)
  values (
    auth.uid(), p_session_id, v_routine.id, v_routine.name,
    case when p_energy in ('light', 'same', 'dialed') then p_energy else 'same' end
  )
  returning * into v_workout;

  if v_routine.id is not null then
    insert into workout_exercises (workout_id, exercise_id, name, position)
    select v_workout.id, re.exercise_id, e.name, re.position
    from routine_exercises re
    join exercises e on e.id = re.exercise_id
    where re.routine_id = v_routine.id;

    update routines set last_used_at = now() where id = v_routine.id;
  end if;

  return v_workout;
end;
$$;

create or replace function add_workout_exercise(p_workout_id uuid, p_exercise_id uuid)
returns workout_exercises
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row workout_exercises;
  v_name text;
begin
  if not exists (select 1 from workouts where id = p_workout_id and user_id = auth.uid() and ended_at is null) then
    raise exception 'This workout is not active.';
  end if;

  select name into v_name from exercises
  where id = p_exercise_id and (created_by is null or created_by = auth.uid());
  if v_name is null then
    raise exception 'Exercise not found.';
  end if;

  insert into workout_exercises (workout_id, exercise_id, name, position)
  values (
    p_workout_id, p_exercise_id, v_name,
    (select coalesce(max(position), -1) + 1 from workout_exercises where workout_id = p_workout_id)
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- "Replace exercise" (§23) — swap in a substitute when a machine's taken, without derailing the
-- routine. Any sets already banked under the OLD lift are dropped (keeping them would credit
-- them to a lift that was never performed), and that lift's stored best is rebuilt so a PR set
-- being discarded can't leave a phantom record. The client warns before calling this when sets
-- exist.
create or replace function replace_workout_exercise(p_workout_exercise_id uuid, p_exercise_id uuid)
returns workout_exercises
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row workout_exercises;
  v_old_exercise_id uuid;
  v_name text;
begin
  select we.* into v_row
  from workout_exercises we
  join workouts w on w.id = we.workout_id
  where we.id = p_workout_exercise_id and w.user_id = auth.uid() and w.ended_at is null;
  if v_row.id is null then
    raise exception 'Exercise not found in this workout.';
  end if;

  select name into v_name from exercises
  where id = p_exercise_id and (created_by is null or created_by = auth.uid());
  if v_name is null then
    raise exception 'Exercise not found.';
  end if;

  v_old_exercise_id := v_row.exercise_id;

  delete from workout_sets where workout_exercise_id = v_row.id;

  update workout_exercises
  set exercise_id = p_exercise_id, name = v_name
  where id = v_row.id
  returning * into v_row;

  perform gym_recompute_pr(auth.uid(), v_old_exercise_id);

  return v_row;
end;
$$;

create or replace function remove_workout_exercise(p_workout_exercise_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercise_id uuid;
begin
  select we.exercise_id into v_exercise_id
  from workout_exercises we
  join workouts w on w.id = we.workout_id
  where we.id = p_workout_exercise_id and w.user_id = auth.uid() and w.ended_at is null;
  if v_exercise_id is null then
    raise exception 'Exercise not found in this workout.';
  end if;

  delete from workout_exercises where id = p_workout_exercise_id;
  perform gym_recompute_pr(auth.uid(), v_exercise_id);
end;
$$;

create or replace function reorder_workout_exercises(p_workout_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
begin
  if not exists (select 1 from workouts where id = p_workout_id and user_id = auth.uid() and ended_at is null) then
    raise exception 'This workout is not active.';
  end if;
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;

  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update workout_exercises set position = i - 1
    where id = p_ordered_ids[i] and workout_id = p_workout_id;
  end loop;
end;
$$;

-- AUTO-PR (§23): the whole point of banking a set server-side. The comparison is against the
-- user's stored best for that exact lift, decided here so the badge the user sees is the same
-- verdict that gets written to their record — the client never gets to decide it earned a PR.
create or replace function log_workout_set(p_workout_exercise_id uuid, p_weight numeric, p_reps int)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_we workout_exercises;
  v_workout workouts;
  v_set workout_sets;
  v_e1rm numeric;
  v_best personal_records;
  v_is_pr boolean;
begin
  select we.* into v_we
  from workout_exercises we
  join workouts w on w.id = we.workout_id
  where we.id = p_workout_exercise_id and w.user_id = auth.uid() and w.ended_at is null;
  if v_we.id is null then
    raise exception 'Exercise not found in this workout.';
  end if;

  select * into v_workout from workouts where id = v_we.workout_id;

  if p_reps is null or p_reps <= 0 then
    raise exception 'A set needs at least one rep.';
  end if;
  if p_weight is not null and p_weight < 0 then
    raise exception 'Weight can''t be negative.';
  end if;

  v_e1rm := gym_e1rm(p_weight, p_reps);
  select * into v_best from personal_records
  where user_id = auth.uid() and exercise_id = v_we.exercise_id;

  v_is_pr := v_best.id is null
    or v_e1rm > v_best.e1rm
    or (v_e1rm = v_best.e1rm and p_reps > v_best.reps);

  insert into workout_sets (workout_id, workout_exercise_id, set_index, weight, reps, is_pr)
  values (
    v_workout.id, v_we.id,
    (select coalesce(max(set_index), 0) + 1 from workout_sets where workout_exercise_id = v_we.id),
    p_weight, p_reps, v_is_pr
  )
  returning * into v_set;

  if v_is_pr then
    insert into personal_records (user_id, exercise_id, weight, reps, e1rm, workout_set_id, achieved_at)
    values (auth.uid(), v_we.exercise_id, coalesce(p_weight, 0), p_reps, v_e1rm, v_set.id, now())
    on conflict (user_id, exercise_id) do update
      set weight = excluded.weight,
          reps = excluded.reps,
          e1rm = excluded.e1rm,
          workout_set_id = excluded.workout_set_id,
          achieved_at = excluded.achieved_at;
  end if;

  return v_set;
end;
$$;

create or replace function delete_workout_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercise_id uuid;
begin
  select we.exercise_id into v_exercise_id
  from workout_sets ws
  join workout_exercises we on we.id = ws.workout_exercise_id
  join workouts w on w.id = ws.workout_id
  where ws.id = p_set_id and w.user_id = auth.uid() and w.ended_at is null;
  if v_exercise_id is null then
    raise exception 'Set not found in an active workout.';
  end if;

  delete from workout_sets where id = p_set_id;
  perform gym_recompute_pr(auth.uid(), v_exercise_id);
end;
$$;

-- ───────────────────────────── reading the live workout ─────────────────────────────
-- Returns the whole in-session state in one round trip: the workout, its exercises in order,
-- every banked set, each lift's stored best, and the energy-nudged SUGGESTED numbers.
--
-- Returns jsonb rather than a RETURNS TABLE deliberately — the shape is genuinely nested
-- (exercises → sets), and a flat table would need the client to re-stitch it. It also sidesteps
-- the RETURNS TABLE column-shadowing footgun this project has already been bitten by.
--
-- ENERGY, rule 1 (§23): GENTLE. Light/Same/Dialed applies a ~±5% nudge to the SUGGESTED numbers
-- only, derived from the top set of the last workout that contained this lift. It is a starting
-- point the client prefills, never a mandate — every set stays fully editable, and nothing here
-- constrains what can be logged.
create or replace function get_active_workout()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_workout workouts;
  v_factor numeric;
  v_result jsonb;
begin
  select * into v_workout from workouts where user_id = auth.uid() and ended_at is null;
  if v_workout.id is null then
    return null;
  end if;

  v_factor := case v_workout.energy when 'light' then 0.95 when 'dialed' then 1.05 else 1.0 end;

  select jsonb_build_object(
    'id', v_workout.id,
    'lock_in_session_id', v_workout.lock_in_session_id,
    'routine_id', v_workout.routine_id,
    'routine_name', v_workout.routine_name,
    'energy', v_workout.energy,
    'started_at', v_workout.started_at,
    'exercises', coalesce(
      (
        select jsonb_agg(ex.payload order by ex.position)
        from (
          select
            we.position,
            jsonb_build_object(
              'id', we.id,
              'exercise_id', we.exercise_id,
              'name', we.name,
              'position', we.position,
              'best', (
                select jsonb_build_object('weight', pr.weight, 'reps', pr.reps)
                from personal_records pr
                where pr.user_id = auth.uid() and pr.exercise_id = we.exercise_id
              ),
              -- The top set of the most recent PREVIOUS workout containing this lift, nudged.
              -- Weight rounds to the nearest 5 so the suggestion is a plate-loadable number
              -- rather than "141.75".
              'suggested', (
                select jsonb_build_object(
                  'weight', case when last.weight is null or last.weight = 0 then null
                                 else greatest(round(last.weight * v_factor / 5) * 5, 0) end,
                  'reps', last.reps
                )
                from (
                  select ws2.weight, ws2.reps
                  from workout_sets ws2
                  join workout_exercises we2 on we2.id = ws2.workout_exercise_id
                  join workouts w2 on w2.id = ws2.workout_id
                  where w2.user_id = auth.uid()
                    and w2.id <> v_workout.id
                    and we2.exercise_id = we.exercise_id
                  order by w2.started_at desc, gym_e1rm(ws2.weight, ws2.reps) desc
                  limit 1
                ) as last
              ),
              'sets', coalesce(
                (
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', ws.id,
                      'set_index', ws.set_index,
                      'weight', ws.weight,
                      'reps', ws.reps,
                      'is_pr', ws.is_pr
                    ) order by ws.set_index
                  )
                  from workout_sets ws where ws.workout_exercise_id = we.id
                ),
                '[]'::jsonb
              )
            ) as payload
          from workout_exercises we
          where we.workout_id = v_workout.id
        ) as ex
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

-- The recap read for the done screen and the posted campfire card — the rolled-up summary plus
-- the energy/brag context that only the workout row carries. Readable for circle-mates (the
-- underlying tables' RLS is what actually gates it; this runs as the caller, not definer).
create or replace function get_workout_recap(p_check_in_id uuid)
returns jsonb
language plpgsql
set search_path = public
stable
as $$
declare
  v_workout workouts;
begin
  select * into v_workout from workouts where check_in_id = p_check_in_id;
  if v_workout.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'workout_id', v_workout.id,
    'routine_name', v_workout.routine_name,
    'energy', v_workout.energy,
    'brag_earned', v_workout.brag_earned,
    'exercises', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'exercise', s.exercise,
            'sets', s.sets,
            'reps', s.reps,
            'weight', s.weight,
            'is_pr', s.is_pr
          ) order by s.position
        )
        from check_in_workout_sets s where s.check_in_id = p_check_in_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- ───────────────────────────── rolling up into the lock-in ─────────────────────────────
-- check_in_workout_sets gains the PR flag so the posted campfire card can show which lifts were
-- bests without joining the whole live log.
alter table check_in_workout_sets add column if not exists is_pr boolean not null default false;

-- Signature is unchanged, but this project has been bitten by accidental overloads before, so
-- drop-first stays the house rule for every reshaped RPC.
drop function if exists stop_lock_in_session(uuid, text[], text, jsonb);

create or replace function stop_lock_in_session(
  p_session_id uuid,
  p_photo_urls text[] default null,   -- ordered Storage paths; null/empty = no photos
  p_caption text default null,
  p_workout_sets jsonb default null   -- legacy batch log (0033); ignored when a live workout exists
)
returns check_ins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_workout workouts;
  v_first_photo text;
  v_has_pr boolean;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active';

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
    greatest(extract(epoch from now() - v_session.started_at)::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  -- The live gym log (migration 0037) takes precedence: it was persisted set-by-set during the
  -- session, so at Finish it only needs binding to this check-in and rolling up into the summary
  -- shape everything downstream already reads.
  select * into v_workout from workouts
  where lock_in_session_id = v_session.id and user_id = auth.uid() and ended_at is null;

  if v_workout.id is not null then
    -- "HONEST BRAG" (§23 rule 2): the "…was feeling dialed today" flex is earned by the lifts
    -- that were LOGGED, never by the mood that was picked. A genuine PR this session is the one
    -- unambiguous proof the user actually hit higher numbers, so that — and only that — unlocks it.
    select exists (select 1 from workout_sets where workout_id = v_workout.id and is_pr)
    into v_has_pr;

    update workouts
    set check_in_id = v_check_in.id,
        ended_at = now(),
        brag_earned = (v_workout.energy = 'dialed' and v_has_pr)
    where id = v_workout.id;

    -- One summary row per exercise: how many sets, and the TOP set's weight×reps (ranked by
    -- e1RM, the same metric the PR check uses), plus whether any set in it was a PR.
    insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, is_pr, position)
    select
      v_check_in.id,
      we.name,
      count(*)::int,
      (array_agg(ws.reps order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc))[1],
      (array_agg(ws.weight order by gym_e1rm(ws.weight, ws.reps) desc, ws.reps desc))[1],
      bool_or(ws.is_pr),
      we.position
    from workout_exercises we
    join workout_sets ws on ws.workout_exercise_id = we.id
    where we.workout_id = v_workout.id
    group by we.id, we.name, we.position;

  elsif p_workout_sets is not null and jsonb_array_length(p_workout_sets) > 0 then
    for i in 0 .. jsonb_array_length(p_workout_sets) - 1 loop
      insert into check_in_workout_sets (check_in_id, exercise, sets, reps, weight, position)
      values (
        v_check_in.id,
        p_workout_sets -> i ->> 'exercise',
        (p_workout_sets -> i ->> 'sets')::int,
        (p_workout_sets -> i ->> 'reps')::int,
        (p_workout_sets -> i ->> 'weight')::numeric,
        i
      );
    end loop;
  end if;

  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id
  where id = v_session.id;

  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$$;
