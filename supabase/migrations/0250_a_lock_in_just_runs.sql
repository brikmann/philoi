-- 0250 — the "still here?" check is cut. A lock-in just runs until it is stopped.
--
-- Product call (2026-10-19): the 18-min "still here? tap to confirm" leash costs more users than the
-- leaderboard gaming it prevents. Start a timer, it accumulates. The whole liveness chain 0221/0226
-- built goes together:
--
--   server nudge    18 min  → gone   (notify_stale_lock_ins, first loop)
--   server close    ~20 min → gone   (notify_stale_lock_ins, second loop)
--   Stop clamp      +20 min → gone   (stop_lock_in_session credits to now())
--   client prompt / freeze  → gone   (src/app/lock-in/index.tsx)
--
-- KEPT: the 3-hour pause cap. A paused session is the user saying they stepped away; that is not the
-- liveness check, and without it a forgotten pause would sit "active" forever.
--
-- last_confirmed_at stays on the table (resume / confirm_lock_in_session still stamp it; installed
-- builds still call confirm). Nothing reads it as a credit bound any more.
--
-- Installed builds still prompt at 16–18 min and auto-pause at 19. Against this server that pause is
-- harmless (no close, the pause cap is 3 h) and one tap resumes; the prompt disappears with the next
-- build.
--
-- Both bodies restated from the LIVE prosrc (pg_get_functiondef, 2026-10-19 — identical to 0226).
-- Signatures unchanged, so CREATE OR REPLACE keeps the existing grants.

CREATE OR REPLACE FUNCTION public.notify_stale_lock_ins()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s lock_in_sessions;
  v_check_in check_ins;
begin
  -- 0250 — the 18-min nudge and the ~20-min idle-abandon are removed. An unpaused session runs
  -- until the user stops it.

  -- 0218 — THE PAUSE CAP, unchanged. Paused for more than 3 hours = ended as completed on pre-pause
  -- credited time.
  for v_s in
    select * from lock_in_sessions
    where status = 'active'
      and paused
      and paused_at < now() - interval '3 hours'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      greatest(lock_in_credited_seconds(v_s, v_s.paused_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'completed', ended_check_in_id = v_check_in.id,
        accumulated_paused_seconds = accumulated_paused_seconds
          + greatest(round(extract(epoch from (now() - paused_at))), 0)::int,
        paused = false,
        paused_at = null
    where id = v_s.id;
  end loop;
end;
$function$;

comment on function public.notify_stale_lock_ins() is
  '0250 — only the 3-hour pause cap remains. The still-here nudge and idle-abandon (0221/0226) are removed: a lock-in runs until stopped.';

CREATE OR REPLACE FUNCTION public.stop_lock_in_session(p_session_id uuid, p_photo_urls text[] DEFAULT NULL::text[], p_caption text DEFAULT NULL::text, p_workout_sets jsonb DEFAULT NULL::jsonb)
 RETURNS check_ins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session lock_in_sessions;
  v_check_in check_ins;
  v_workout workouts;
  v_first_photo text;
  v_has_pr boolean;
  i int;
begin
  select * into v_session from lock_in_sessions
  where id = p_session_id and user_id = auth.uid() and status = 'active'
  for update;

  if v_session.id is null then
    raise exception 'Session not found or already stopped.';
  end if;

  v_first_photo := case when p_photo_urls is not null and array_length(p_photo_urls, 1) > 0
    then p_photo_urls[1] else null end;

  insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, caption, duration_seconds, status)
  values (
    null, v_session.goal_type, v_session.goal_detail, auth.uid(), v_first_photo, p_caption,
    -- 0218: credited time, not wall-clock (paused time earns nothing).
    -- 0250: to now(). The last-confirmation clamp (0221/0226) is gone with the still-here check.
    greatest(lock_in_credited_seconds(v_session, now())::integer, 1),
    'on_time'
  )
  returning * into v_check_in;

  if p_photo_urls is not null then
    for i in 1 .. array_length(p_photo_urls, 1) loop
      insert into check_in_photos (check_in_id, photo_url, position)
      values (v_check_in.id, p_photo_urls[i], i - 1);
    end loop;
  end if;

  select * into v_workout from workouts
  where lock_in_session_id = v_session.id and user_id = auth.uid() and ended_at is null;

  if v_workout.id is not null then
    select exists (select 1 from workout_sets where workout_id = v_workout.id and is_pr)
    into v_has_pr;

    update workouts
    set check_in_id = v_check_in.id,
        ended_at = now(),
        brag_earned = (v_workout.energy = 'dialed' and v_has_pr)
    where id = v_workout.id;

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

  -- 0218: fold an open pause into the total and clear it.
  update lock_in_sessions
  set status = 'completed', ended_check_in_id = v_check_in.id,
      accumulated_paused_seconds = accumulated_paused_seconds
        + case when paused then greatest(round(extract(epoch from (now() - paused_at))), 0)::int else 0 end,
      paused = false,
      paused_at = null
  where id = v_session.id;

  select * into v_check_in from check_ins where id = v_check_in.id;

  return v_check_in;
end;
$function$;

comment on function public.stop_lock_in_session(uuid, text[], text, jsonb) is
  '0250 — 0226''s pause-aware body, crediting to now(): the last_confirmed_at + 20 min clamp is removed with the still-here check.';

-- ─────────────────────────────── asserts ───────────────────────────────
do $assert$
declare
  v_stale text := (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace);
  v_stop  text := (select prosrc from pg_proc where proname = 'stop_lock_in_session' and pronamespace = 'public'::regnamespace);
begin
  if v_stale ~ 'notify_push' or v_stale ~ '''abandoned''' or v_stale ~ 'reminder_sent_at'
     or v_stale !~ 'paused_at < now\(\) - interval ''3 hours''' then
    raise exception '0250: notify_stale_lock_ins still nudges / abandons, or lost the pause cap.';
  end if;
  if v_stop ~ 'interval ''20 minutes'''
     or v_stop !~ 'lock_in_credited_seconds\(v_session, now\(\)\)'
     or v_stop !~ 'check_in_workout_sets'
     or v_stop !~ 'accumulated_paused_seconds' then
    raise exception '0250: stop_lock_in_session is still clamped, or lost its workout / pause folding.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('notify_stale_lock_ins', 'stop_lock_in_session')) <> 2 then
    raise exception '0250: an overload was created.';
  end if;
end
$assert$;
