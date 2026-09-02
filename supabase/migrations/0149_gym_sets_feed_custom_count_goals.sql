-- 0149 — reps logged in a gym lock-in count toward a custom COUNT goal.
--
-- Noah: a challenge made with Cindy — "track 1000 pushups in a day" — has no way for the reps you
-- actually did in a gym session to reach it. Someone does 50 sets of 20 in the gym tracker, the
-- app records every one of them, and the goal card still says 0 / 1000 until they go and type it
-- in by hand.
--
-- ─────────────────────────── the gap, precisely ───────────────────────────
--
-- `challenges` has exactly two feeders. credit_lockin_time_goals_for (0116) fills a custom goal
-- whose count_mode is 'lockin_time' with the HOURS of a matching lock-in. The client-side device
-- syncs fill the built-in metrics. A custom goal with count_mode='manual' — which is what
-- "1000 pushups" is, and what Cindy creates — has no feeder at all. It was manual by definition.
--
-- That was right when the only thing that could produce a count was a person typing one. It stopped
-- being right when the gym tracker started recording sets and reps: the number exists, it is
-- already in the database, and it is attached to the same user's own lock-in.
--
-- ─────────────────────────── where this hooks, and why there ───────────────────────────
--
-- On `check_in_workout_sets`, AFTER INSERT.
--
-- Both gym paths converge on that table inside stop_lock_in_session: the batch submitter writes it
-- straight from `p_workout_sets` (0033), and the live gym tracker rolls its per-set rows up into it
-- (0037). One trigger therefore covers both, and covers them at the moment the session ends rather
-- than mid-workout — which is also the anti-farming boundary, since a set only exists here once the
-- lock-in it belongs to has been stopped.
--
-- NOT a trigger on `check_ins`, which is where credit_lockin_time_goals_on_check_in (0113) sits:
-- stop_lock_in_session inserts the check-in FIRST and the sets after it, so a check-in trigger runs
-- before there is a single set to read.
--
-- ─────────────────────────── how many reps is "the reps" ───────────────────────────
--
-- `check_in_workout_sets` does not mean the same thing on both paths, and using it naively would
-- silently miscount the goal this exists to fill:
--
--   · batch (0033): one row per line the user typed — sets=5, reps=20 means "5 × 20". 100 reps.
--   · live tracker (0037): one SUMMARY row per exercise — sets is the number of sets logged, and
--     reps is the TOP set's reps, ranked by e1RM. A session of 20, 18, 15 rolls up as
--     sets=3, reps=20, and `sets * reps` claims 60 for 53 real reps.
--
-- So when the underlying per-set rows exist they are what gets counted — `sum(workout_sets.reps)`
-- through `workouts.check_in_id` — and `sets * reps` is the fallback for the batch path, where it
-- is exact. The goal is a count of reps done; it should be the count of reps done.
--
-- 🔒 PRESENTATION OF WORK ALREADY RECORDED, NOT A NEW WAY TO EARN. The payout is untouched: this
-- writes a challenge_log and moves `progress` exactly the way a hand-logged entry does, and when
-- that crosses the target it sets completed_at, which is what economy_on_challenge_completed (0065)
-- has always watched. One completion, one drip, through the same door. Idempotent on the set row's
-- id, so a replay cannot credit twice.

create or replace function credit_count_goals_for_workout_set(p_set check_in_workout_sets)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_exercise text := lower(trim(coalesce(p_set.exercise, '')));
  v_reps numeric;
  v_note text;
  v_goal challenges;
  v_credited int := 0;
begin
  if v_exercise = '' then
    return 0;
  end if;

  select ci.user_id into v_user from check_ins ci where ci.id = p_set.check_in_id;
  if v_user is null then
    return 0;
  end if;

  -- The true per-set total when the live tracker's rows are there; the batch path's exact
  -- sets × reps otherwise. See the header — these two are NOT the same number.
  select sum(ws.reps) into v_reps
  from workouts w
  join workout_exercises we on we.workout_id = w.id
  join workout_sets ws on ws.workout_exercise_id = we.id
  where w.check_in_id = p_set.check_in_id
    and lower(trim(we.name)) = v_exercise;

  if v_reps is null then
    v_reps := coalesce(p_set.sets, 0)::numeric * coalesce(p_set.reps, 0)::numeric;
  end if;

  if v_reps <= 0 then
    return 0;
  end if;

  -- Tagged with the SET row, not the check-in: a session with pushups and squats writes two rows
  -- against the same check-in, and a check-in-scoped tag would let the second one look already
  -- credited and be dropped.
  v_note := 'Gym set · ' || p_set.id::text;

  for v_goal in
    select * from challenges
    where user_id = v_user
      and type = 'custom'
      -- 'lockin_time' custom goals are counted in HOURS by 0116 and adding reps to them would be
      -- adding two units together. This is the count-I-log shape only (mock 74).
      and count_mode = 'manual'
      and completed_at is null
      and label is not null
      and lower(trim(label)) = v_exercise
  loop
    if exists (
      select 1 from challenge_logs
      where challenge_id = v_goal.id and note = v_note
    ) then
      continue;
    end if;

    insert into challenge_logs (challenge_id, user_id, amount, note)
    values (v_goal.id, v_user, v_reps, v_note);

    -- Byte-for-byte the update log_challenge_progress (0059) and credit_lockin_time_goals_for
    -- (0116) both perform, so a goal finished by a gym session lands in identical state to one
    -- finished by hand and wakes economy_on_challenge_completed exactly once.
    update challenges
    set progress = progress + v_reps,
        completed_at = case
          when completed_at is null and progress + v_reps >= target then now()
          else completed_at
        end
    where id = v_goal.id;

    v_credited := v_credited + 1;
  end loop;

  return v_credited;
end;
$$;

comment on function credit_count_goals_for_workout_set(check_in_workout_sets) is
  '0149 — a gym lock-in''s logged reps credit a matching custom count goal ("1000 pushups"), matched on exercise name = goal label, the same way 0116 matches goal_detail. Counts real per-set reps when the live tracker recorded them; sets × reps on the batch path.';

-- Neither PUBLIC nor authenticated: this is a trigger's helper, and 0132's rule is that an
-- economy internal is not an RPC. Nothing outside the trigger has any business calling it.
revoke all on function credit_count_goals_for_workout_set(check_in_workout_sets) from public;
revoke all on function credit_count_goals_for_workout_set(check_in_workout_sets) from authenticated;

create or replace function credit_count_goals_on_workout_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Best-effort, exactly like the lock-in feeder: a goal that failed to take its credit is a
  -- missing number the user can still log by hand, and failing here would roll back the workout
  -- they actually did.
  begin
    perform credit_count_goals_for_workout_set(new);
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists credit_count_goals_after_workout_set on check_in_workout_sets;
create trigger credit_count_goals_after_workout_set
after insert on check_in_workout_sets
for each row execute function credit_count_goals_on_workout_set();
