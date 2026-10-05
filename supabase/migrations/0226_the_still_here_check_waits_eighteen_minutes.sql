-- 0226 — the "still here?" check moves from ~10 min to ~18 min.
--
-- 10 min was too short a leash for a real focus block. The whole liveness chain moves together,
-- keeping every ordering 0221 relied on:
--
--   client prompt   [8,10] min  → [16,18] min   (src/app/lock-in/index.tsx, STILL_HERE_BASE_MS)
--   client freeze   11 min      → 19 min        (STILL_HERE_FREEZE_MS — must stay < server close)
--   server nudge    10 min      → 18 min        (notify_stale_lock_ins, below)
--   server close    ~12 min     → ~20 min       (nudge + the unchanged 2-min grace)
--   Stop clamp      +12 min     → +20 min       (stop_lock_in_session, below)
--
-- The Stop clamp HAS to move with the prompt: left at +12, a present user who taps Stop at
-- minute 17 (before they've ever been asked) would be credited only 12.
--
-- Installed builds still prompt at 8–10 and freeze at 11. Against this server they are simply
-- asked earlier than needed — every client deadline still lands before the server's, so nothing
-- an old build does can lose a session. The longer interval reaches users with the next build.
--
-- Both bodies are restated from the LIVE prosrc (pg_get_functiondef, 2026-10-05), not a repo
-- file, so nothing a sibling branch put in them is reverted. Only the intervals + their comments
-- change. Signatures are unchanged, so CREATE OR REPLACE keeps the existing grants.

CREATE OR REPLACE FUNCTION public.notify_stale_lock_ins()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_s lock_in_sessions;
  v_check_in check_ins;
begin
  for r in
    select id, user_id from lock_in_sessions
    where status = 'active'
      and not paused
      and reminder_sent_at is null
      -- 0226 — 18 min (0221 had 10). Matches the client's [16,18]-min "still here?" prompt.
      and last_confirmed_at < now() - interval '18 minutes'
  loop
    perform notify_push(
      array[r.user_id],
      'Still locked in?',
      'Your session''s been going a while — tap to keep it going.',
      jsonb_build_object('type', 'lockin_still_here', 'session_id', r.id),
      'accountability'
    );
    update lock_in_sessions set reminder_sent_at = now() where id = r.id;
  end loop;

  for v_s in
    select * from lock_in_sessions
    where status = 'active'
      and not paused
      and reminder_sent_at is not null
      -- 0221 — 2 min after the nudge (was 20). 0226: total stale-close ~20 min (18 + grace).
      and reminder_sent_at < now() - interval '2 minutes'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      -- 0218/0221 — the credit CAP: to last confirmation, minus paused time. Never now().
      greatest(lock_in_credited_seconds(v_s, v_s.last_confirmed_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = v_s.id;
  end loop;

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
  '0226 — 0221''s body with the stale-close lengthened to ~20 min (18-min nudge + 2-min grace, was 10 + 2). The idle-abandon still credits only to last_confirmed_at. Pause cap unchanged.';

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
    -- 0221: AND clamped to the grace window past the last confirmation, so a nap-then-finish
    -- cannot bank the idle stretch. 0226: least(now(), last_confirmed_at + 20 min) — a present
    -- user (confirming every ~16-18 min) is always below this bound and is never trimmed.
    greatest(lock_in_credited_seconds(v_session, least(now(), v_session.last_confirmed_at + interval '20 minutes'))::integer, 1),
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
  '0226 — 0221''s pause-aware body with the finish credit clamped to least(now(), last_confirmed_at + 20 min) (was 12), matching the ~18-min still-here prompt.';

-- ─────────────────────────────── asserts ───────────────────────────────
do $assert$
declare
  v_stale text := (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace);
  v_stop  text := (select prosrc from pg_proc where proname = 'stop_lock_in_session' and pronamespace = 'public'::regnamespace);
begin
  if v_stale !~ 'and last_confirmed_at < now\(\) - interval ''18 minutes'''
     or v_stale !~ 'reminder_sent_at < now\(\) - interval ''2 minutes'''
     or v_stale !~ 'lock_in_credited_seconds\(v_s, v_s\.last_confirmed_at\)'
     or v_stale !~ 'paused_at < now\(\) - interval ''3 hours''' then
    raise exception '0226: notify_stale_lock_ins is not at 18 + 2 min, or lost the credit cap / pause cap.';
  end if;
  if v_stop !~ 'v_session\.last_confirmed_at \+ interval ''20 minutes'''
     or v_stop !~ 'check_in_workout_sets'
     or v_stop !~ 'accumulated_paused_seconds' then
    raise exception '0226: stop_lock_in_session is not clamped at +20 min, or lost its workout / pause folding.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('notify_stale_lock_ins', 'stop_lock_in_session')) <> 2 then
    raise exception '0226: an overload was created.';
  end if;
  if (select schedule from cron.job where jobname = 'philoi-lockin-liveness-check') is distinct from '* * * * *' then
    raise exception '0226: the liveness sweep is no longer scheduled every minute.';
  end if;
end
$assert$;
