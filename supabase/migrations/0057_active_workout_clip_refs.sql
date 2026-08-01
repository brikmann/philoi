-- Surface each banked set's clip reference in the LIVE session logger.
--
-- 0054 added workout_sets.video_key/thumb_key and 0055 exposed them for the recap
-- (get_check_in_clips), but get_active_workout() — the one read the in-session logger runs —
-- still built its `sets` payload from 0037's column list, which predates clips entirely. So the
-- per-set camera affordance had no way to know a set was ALREADY filmed: reopening the app
-- mid-workout redrew every row as un-filmed, inviting a second recording that burns another
-- clip off the user's monthly quota and overwrites the first.
--
-- Signature is unchanged (no args, still returns jsonb), so create-or-replace can't strand a
-- second overload here — the hazard that needs a drop-first is a CHANGED parameter list.

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
                      'is_pr', ws.is_pr,
                      -- New in 0057. Only the REFERENCES travel here, never a URL: playback is
                      -- always a freshly signed GET from the gym-clip-playback-url function, so
                      -- a stale payload can't hand out a long-lived link to private bytes.
                      'video_key', ws.video_key,
                      'thumb_key', ws.thumb_key
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
