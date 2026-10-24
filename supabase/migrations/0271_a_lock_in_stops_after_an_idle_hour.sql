-- 0271 — auto-stop comes back: a lock-in with no activity for over an hour stops itself.
--
-- 0250 cut the 18-min "still here?" leash and, with it, every close of an unpaused session. Since
-- then nothing ends a forgotten timer: on 2026-10-24 prod had one session "active" for ~3 days and
-- a 12.8-hour check-in completed that morning. Product call (2026-10-24): over one hour of
-- inactivity → auto-stop. No prompt comes back; 0250's "start a timer, it accumulates" holds for
-- anyone who is actually around.
--
-- ─────────────────────────────── WHAT COUNTS AS ACTIVITY ───────────────────────────────
--
-- The latest of:
--   started_at                  — the start itself
--   last_confirmed_at           — resume_lock_in_session / confirm_lock_in_session still stamp it
--   last_active_at   (NEW)      — stamped by beat_lockin_presence, the lock-in screen's 45s beat.
--                                  Shipped 2026-09-12, so every installed build feeds it with no
--                                  app update. The beat only fires while the screen is focused and
--                                  the app foregrounded (useGatedInterval), and the screen holds a
--                                  keep-awake, so a phone left on the lock-in screen stays active.
--   user_presence.last_seen_at  — the app-wide 60s heartbeat (0245/0262). Only newer builds send
--                                  it (1 row in prod on 2026-10-24), so it is a bonus, never the
--                                  only signal.
-- lockin_presence.last_beat_at is NOT usable: the 90s reaper deletes the row.
--
-- ─────────────────────────────── HOW IT STOPS ───────────────────────────────
--
-- Exactly like the user tapping Stop at (last activity + 1 hour):
--   - status 'completed', not 0221's 'abandoned' — 'abandoned' withholds embers / pass credit
--     (economy_on_lock_in_completed pays only on 'completed');
--   - credited to least(last activity + 1h, now()) via lock_in_credited_seconds, so the cron's
--     1-minute cadence never adds time and a long-dead session (the 3-day one) earns one hour;
--   - an open gym workout is closed and its sets copied, as stop_lock_in_session does.
-- Paused sessions are untouched here — the 3-hour pause cap (0218) still owns them.
--
-- notify_stale_lock_ins / beat_lockin_presence restated from LIVE prosrc (pg_get_functiondef,
-- 2026-10-24 — notify_stale_lock_ins identical to 0250). Signatures unchanged, so CREATE OR
-- REPLACE keeps the existing grants. The cron job (philoi-lockin-liveness-check, every minute)
-- already calls notify_stale_lock_ins.

alter table public.lock_in_sessions add column if not exists last_active_at timestamptz;

comment on column public.lock_in_sessions.last_active_at is
  '0271 — last lock-in-screen heartbeat (beat_lockin_presence, 30s throttle). One input to the 1-hour idle auto-stop.';

CREATE OR REPLACE FUNCTION public.beat_lockin_presence(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_session lock_in_sessions%rowtype;
  v_category text;
  v_activity text;
  v_campus text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_session
  from lock_in_sessions
  where id = p_session_id and user_id = v_uid and status = 'active';

  if not found then
    -- The session ended (or was never theirs). Beating for a dead session is how a count drifts, so
    -- treat it as the goodbye the client did not get to send rather than as an error to surface —
    -- there is nothing the member could do about it and nothing to tell them.
    delete from lockin_presence where user_id = v_uid;
    return;
  end if;

  -- 0271 — the beat is the activity signal for the 1-hour idle auto-stop. Same 30s throttle as
  -- touch_presence, so a double-fire is a no-op rather than a row rewrite.
  update lock_in_sessions
     set last_active_at = now()
   where id = v_session.id
     and (last_active_at is null or last_active_at < now() - interval '30 seconds');

  select pair.category, pair.activity into v_category, v_activity
  from lockin_pair_of(v_session.category, v_session.activity, v_session.goal_type) pair;

  select p.university into v_campus from profiles p where p.id = v_uid;

  insert into lockin_presence (user_id, session_id, category, activity, university, started_at, last_beat_at)
  values (v_uid, p_session_id, v_category, v_activity, v_campus, v_session.started_at, now())
  on conflict (user_id) do update
    set session_id = excluded.session_id,
        category = excluded.category,
        activity = excluded.activity,
        university = excluded.university,
        started_at = excluded.started_at,
        last_beat_at = now();
end;
$function$;

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
  v_until timestamptz;
  v_workout workouts;
  v_has_pr boolean;
begin
  -- 0271 — THE IDLE AUTO-STOP. Unpaused, and no activity for over an hour = stopped as completed,
  -- credited to the moment the hour ran out. greatest() skips nulls, and started_at is never null.
  for r in
    select s.id,
           greatest(s.started_at, s.last_confirmed_at, s.last_active_at, up.last_seen_at) as last_activity
    from lock_in_sessions s
    left join user_presence up on up.user_id = s.user_id
    where s.status = 'active'
      and not s.paused
      and greatest(s.started_at, s.last_confirmed_at, s.last_active_at, up.last_seen_at)
            < now() - interval '1 hour'
  loop
    -- Re-read under lock: a Stop or pause racing this tick wins, and the row is skipped.
    select * into v_s from lock_in_sessions
    where id = r.id and status = 'active' and not paused
    for update skip locked;
    continue when v_s.id is null;

    v_until := least(r.last_activity + interval '1 hour', now());

    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      greatest(lock_in_credited_seconds(v_s, v_until)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    -- An open gym workout closes with the session, as stop_lock_in_session does.
    select * into v_workout from workouts
    where lock_in_session_id = v_s.id and user_id = v_s.user_id and ended_at is null;

    if v_workout.id is not null then
      select exists (select 1 from workout_sets where workout_id = v_workout.id and is_pr)
      into v_has_pr;

      update workouts
      set check_in_id = v_check_in.id,
          ended_at = v_until,
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
    end if;

    update lock_in_sessions
    set status = 'completed', ended_check_in_id = v_check_in.id
    where id = v_s.id;

    delete from lockin_presence where session_id = v_s.id;
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
  '0271 — idle auto-stop: unpaused with no activity (start / confirm / lock-in beat / app heartbeat) for over 1 hour = completed, credited to last activity + 1h. Plus the 0218 3-hour pause cap.';
