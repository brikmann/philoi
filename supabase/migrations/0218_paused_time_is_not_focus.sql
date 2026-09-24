-- 0218 — Paused time is not focus.
--
-- Pause / resume on a running lock-in (task #205, design-mocks/218-lockin-pause.html). The UI half
-- is a button; this is the half that makes the button safe. Without it, pausing is a way to leave
-- the clock running while you walk away — i.e. a way to mint duration, and everything that pays by
-- duration (XP, goal credit, the flare ramp, embers, the pass, relics, streak minimums) would pay
-- for time nobody spent.
--
-- ─────────────────────────────── THE ONE LINE THAT MATTERS ───────────────────────────────
--
-- Credited seconds = (until − started_at) − accumulated_paused_seconds − (open pause window)
--
-- computed SERVER-SIDE FROM THE STORED COLUMNS, in exactly one function, lock_in_credited_seconds.
-- No client ever supplies a duration: stop_lock_in_session never took one, and lock_in_sessions
-- has a SELECT-only RLS policy, so the only writers of the three new columns are the two RPCs below
-- (checked 2026-09-24: one policy, "read if circle-mate", cmd SELECT).
--
-- Every payout already reads check_ins.duration_seconds and nothing else — the economy trigger
-- (since 0188), notify_session_complete, pass achievements, relics, challenge metrics. So fixing
-- the ONE value stop_lock_in_session writes there fixes all of them, with no restatement of any
-- payout body. That was verified against live prosrc before drafting, not assumed.
--
-- ─────────────────────────────── WHAT CHANGES ───────────────────────────────
--
-- 1. lock_in_sessions gains paused / paused_at / accumulated_paused_seconds. Additive and
--    defaulted: every existing row, and every row an installed build creates, reads "never
--    paused", and every formula below reduces to the old wall-clock one for such a row.
-- 2. lock_in_credited_seconds(session, until) — the formula. Internal.
-- 3. lock_in_credited_seconds_so_far — the seam 0193 left for this migration ("#205 replaces this
--    body, and only this body"). Now calls (2). Cindy's minutes_so_far becomes pause-aware with no
--    restatement of get_coach_context, which is the point of that seam.
-- 4. pause_lock_in_session / resume_lock_in_session — owner-scoped, idempotent, return the row so
--    the client takes paused_at from the SERVER clock (the same clock started_at is on).
-- 5. stop_lock_in_session — restated from LIVE prosrc. Three edits, nothing else:
--      - the select takes FOR UPDATE, so a pause/resume racing a stop can't interleave;
--      - duration_seconds = lock_in_credited_seconds(v_session, now()), floor 1 as before;
--      - the final update folds an open pause into accumulated_paused_seconds and clears it, so
--        a finished row records its total paused time and never reads as still-paused.
--    Stopping WHILE paused therefore settles on the pre-pause time: the open window is excluded.
-- 6. notify_stale_lock_ins (the 5-minute cron) — restated from LIVE prosrc:
--      - the "still locked in?" push and the idle auto-abandon both skip paused sessions (they
--        paused on purpose; don't nag, and don't abandon them for not confirming);
--      - the idle auto-abandon credits (last_confirmed_at − started_at) MINUS paused time — it
--        used to be pure wall-clock to last confirmation, which pausing would have inflated;
--      - NEW: the pause cap. A session paused for more than 3 hours is ended as COMPLETED,
--        banking its pre-pause credited time. Completed, not abandoned: the user explicitly
--        paused, so the minutes before the pause are as attended as any stopped session's, and
--        "abandoned" would withhold the embers / pass credit (economy_on_lock_in_completed only
--        pays on 'completed'). 3h is long enough for a lecture or a meal, short enough that a
--        forgotten session doesn't sit open overnight on a lock screen.
-- 7. live_status — restated from LIVE prosrc: friends see "paused · Study · 42m" with credited
--    minutes, instead of "locked in now" with a wall-clock that keeps climbing through the pause.
--
-- resume_lock_in_session sets last_confirmed_at = now() — "on resume, reset the confirmation
-- clock". That is also what keeps the idle-abandon formula exact: every completed pause ends at or
-- before last_confirmed_at, so subtracting accumulated_paused_seconds from (last_confirmed_at −
-- started_at) never subtracts time after the bound.
--
-- ─────────────────────────────── NOT CHANGED, NOTICED ───────────────────────────────
--
-- - economy_on_social_challenge_closed still thresholds on (last_confirmed_at − started_at), the
--   ~0-per-row expression 0188 fixed everywhere else. Resume now moves last_confirmed_at, so a
--   paused-then-resumed session can clear that threshold with paused time in it. Pre-existing
--   broken metric, ~300-line body, out of scope — it wants check_ins.duration_seconds like the rest.
-- - economy_locked_in_with_friend estimates a session's end as started_at + duration_seconds, which
--   now undershoots a paused session's real end, so an overlap can be missed. Conservative (it can
--   only withhold a "with a friend" bonus, never mint one).
-- - get_coach_context.completed_session_hours: same pre-existing ~0 expression 0193 flagged.

-- ── base check · every body restated below is restated from the LIVE one ──
do $base$
declare
  v_expect constant jsonb := jsonb_build_object(
    'stop_lock_in_session',            '32ab823f0b0d2c9e792a22cd818deebd',
    'notify_stale_lock_ins',           '0824d3820d9bda6f1e654f9224cdbfe4',
    'lock_in_credited_seconds_so_far', '0faab238795956618ecca1634d61ec3b',
    'live_status',                     'ad8f88fbe55c3410ce7d3233ecd54186'
  );
  v_name text;
  v_live text;
begin
  for v_name in select jsonb_object_keys(v_expect) loop
    -- CR-stripped: a body applied from a CRLF checkout must not fail an otherwise identical pin.
    select md5(replace(p.prosrc, chr(13), '')) into v_live
    from pg_proc p where p.proname = v_name and p.pronamespace = 'public'::regnamespace;
    if v_live is distinct from v_expect ->> v_name then
      raise exception '0218: live % changed since this file was drafted (md5 %) — rebase onto it', v_name, v_live;
    end if;
  end loop;
end;
$base$;

-- ═══════════════════════════════ 1 · the columns ═══════════════════════════════

alter table lock_in_sessions add column if not exists paused boolean not null default false;
alter table lock_in_sessions add column if not exists paused_at timestamptz;
alter table lock_in_sessions add column if not exists accumulated_paused_seconds int not null default 0;

-- `paused` is redundant with `paused_at is not null` by design (the client reads a boolean), so
-- the two are pinned together rather than trusted to agree.
alter table lock_in_sessions drop constraint if exists lock_in_sessions_pause_shape;
alter table lock_in_sessions add constraint lock_in_sessions_pause_shape
  check (paused = (paused_at is not null) and accumulated_paused_seconds >= 0);

comment on column lock_in_sessions.paused is 'True while the user has the session paused. 0218.';
comment on column lock_in_sessions.paused_at is 'When the current pause began; null when running. 0218.';
comment on column lock_in_sessions.accumulated_paused_seconds is
  'Total seconds of COMPLETED pauses. The open one (paused_at → now) is added on resume/stop. 0218.';

-- ═══════════════════════════════ 2 · the formula ═══════════════════════════════

create or replace function lock_in_credited_seconds(p_session lock_in_sessions, p_until timestamptz)
returns numeric
language sql
stable
set search_path = public
as $$
  select greatest(
    extract(epoch from (p_until - p_session.started_at))
      - p_session.accumulated_paused_seconds
      - case
          when p_session.paused and p_session.paused_at < p_until
            then extract(epoch from (p_until - p_session.paused_at))
          else 0
        end,
    0
  );
$$;

comment on function lock_in_credited_seconds(lock_in_sessions, timestamptz) is
  'THE credited-focus formula: wall time to p_until minus completed pauses minus the open pause. '
  'Every settled or displayed session duration goes through here. 0218.';

revoke all on function public.lock_in_credited_seconds(lock_in_sessions, timestamptz) from public, anon, authenticated;

-- ═══════════════════════════════ 3 · the seam 0193 left ═══════════════════════════════

create or replace function lock_in_credited_seconds_so_far(p_session_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select lock_in_credited_seconds(s, now())
  from lock_in_sessions s
  where s.id = p_session_id;
$$;

comment on function lock_in_credited_seconds_so_far(uuid) is
  'Seconds of focus a lock-in session has earned so far, excluding paused time. Read by '
  'get_coach_context. 0193 seam, 0218 body.';

revoke all on function public.lock_in_credited_seconds_so_far(uuid) from public, anon, authenticated;

-- ═══════════════════════════════ 4 · pause / resume ═══════════════════════════════

create or replace function pause_lock_in_session(p_session_id uuid)
returns lock_in_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
begin
  update lock_in_sessions
  set paused = true, paused_at = now()
  where id = p_session_id and user_id = auth.uid() and status = 'active' and not paused
  returning * into v_session;

  -- Already paused is success, not an error: a double-tap, or a retry after a dropped response,
  -- must leave the original paused_at alone and hand back the row as it stands.
  if v_session.id is null then
    select * into v_session from lock_in_sessions
    where id = p_session_id and user_id = auth.uid() and status = 'active';
    if v_session.id is null then
      raise exception 'Session not found or already stopped.';
    end if;
  end if;

  return v_session;
end;
$$;

create or replace function resume_lock_in_session(p_session_id uuid)
returns lock_in_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session lock_in_sessions;
begin
  -- last_confirmed_at / reminder_sent_at: coming back IS the "still here?" answer, so the
  -- confirmation clock restarts from the resume rather than nagging on the next cron tick.
  update lock_in_sessions
  set accumulated_paused_seconds =
        accumulated_paused_seconds + greatest(round(extract(epoch from (now() - paused_at))), 0)::int,
      paused = false,
      paused_at = null,
      last_confirmed_at = now(),
      reminder_sent_at = null
  where id = p_session_id and user_id = auth.uid() and status = 'active' and paused
  returning * into v_session;

  if v_session.id is null then
    select * into v_session from lock_in_sessions
    where id = p_session_id and user_id = auth.uid() and status = 'active';
    if v_session.id is null then
      raise exception 'Session not found or already stopped.';
    end if;
  end if;

  return v_session;
end;
$$;

revoke all on function public.pause_lock_in_session(uuid) from public, anon;
revoke all on function public.resume_lock_in_session(uuid) from public, anon;
grant execute on function public.pause_lock_in_session(uuid) to authenticated;
grant execute on function public.resume_lock_in_session(uuid) to authenticated;

-- ═══════════════════════════════ 5 · stop — settles on credited time ═══════════════════════════════
-- Restated from LIVE prosrc (md5 32ab823f… CR-stripped). Edits marked 0218.

create or replace function public.stop_lock_in_session(p_session_id uuid, p_photo_urls text[] DEFAULT NULL::text[], p_caption text DEFAULT NULL::text, p_workout_sets jsonb DEFAULT NULL::jsonb)
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
  -- 0218: FOR UPDATE, so a pause/resume landing mid-stop waits instead of interleaving.
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
    -- 0218: credited time, not wall-clock. Paused time — including a pause still open at Stop —
    -- earns nothing, and every payout downstream reads this one value.
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

  -- 0218: fold an open pause into the total and clear it, so a finished row records all of its
  -- paused time and never reads as still-paused.
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

-- ═══════════════════════════════ 6 · the liveness cron ═══════════════════════════════
-- Restated from LIVE prosrc (md5 0824d382…). Edits marked 0218.

create or replace function public.notify_stale_lock_ins()
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
      and not paused  -- 0218: they paused on purpose; don't ask if they're still there
      and reminder_sent_at is null
      and last_confirmed_at < now() - interval '1 hour'
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
      and not paused  -- 0218: a paused session is governed by the pause cap below, not this
      and reminder_sent_at is not null
      and reminder_sent_at < now() - interval '20 minutes'
  loop
    insert into check_ins (goal_id, goal_type, goal_detail, user_id, photo_url, duration_seconds, status)
    values (
      null, v_s.goal_type, v_s.goal_detail, v_s.user_id, null,
      -- 0218: to last confirmation, minus paused time. Every completed pause ends at or before
      -- last_confirmed_at (resume sets it), so this never subtracts time past the bound.
      greatest(lock_in_credited_seconds(v_s, v_s.last_confirmed_at)::integer, 1),
      'on_time'
    )
    returning * into v_check_in;

    update lock_in_sessions
    set status = 'abandoned', ended_check_in_id = v_check_in.id
    where id = v_s.id;
  end loop;

  -- 0218: THE PAUSE CAP. Paused for more than 3 hours = they're not coming back to this one. End
  -- it as completed on its pre-pause credited time (header §6 for why completed, and why 3h).
  -- Credited to paused_at, which is the same number as to now() — the open window is excluded
  -- either way — but says what it means.
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

-- ═══════════════════════════════ 7 · what friends see ═══════════════════════════════
-- Restated from LIVE prosrc (md5 ad8f88fb…). Only the active-session branch changes.

create or replace function public.live_status(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session lock_in_sessions;
  v_last_check_in timestamptz;
  v_elapsed_minutes int;
begin
  select * into v_session from lock_in_sessions where user_id = p_user_id and status = 'active';
  if v_session.id is not null then
    -- 0218: credited minutes (frozen while paused), and say so when they are.
    v_elapsed_minutes := floor(lock_in_credited_seconds(v_session, now()) / 60)::int;
    return case when v_session.paused then 'paused · ' else 'locked in now · ' end
      || initcap(v_session.goal_type) || ' · ' || v_elapsed_minutes || 'm';
  end if;

  select max(created_at) into v_last_check_in from check_ins where user_id = p_user_id and removed_at is null;
  if v_last_check_in is null then
    return 'no activity yet';
  end if;

  return 'last active ' || case
    when now() - v_last_check_in < interval '1 hour' then extract(epoch from now() - v_last_check_in)::int / 60 || 'm ago'
    when now() - v_last_check_in < interval '24 hours' then extract(epoch from now() - v_last_check_in)::int / 3600 || 'h ago'
    else extract(epoch from now() - v_last_check_in)::int / 86400 || 'd ago'
  end;
end;
$function$;

-- ── post-check · each assert fails on the pre-0218 state ──
do $post$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'lock_in_sessions'
        and column_name in ('paused', 'paused_at', 'accumulated_paused_seconds')) <> 3 then
    raise exception '0218: pause columns missing';
  end if;

  if (select prosrc from pg_proc where proname = 'stop_lock_in_session' and pronamespace = 'public'::regnamespace)
     !~ 'lock_in_credited_seconds\(v_session, now\(\)\)' then
    raise exception '0218: stop_lock_in_session does not settle on credited time';
  end if;
  if (select prosrc from pg_proc where proname = 'stop_lock_in_session' and pronamespace = 'public'::regnamespace)
     ~ 'extract\(epoch from now\(\) - v_session\.started_at\)' then
    raise exception '0218: stop_lock_in_session still carries the wall-clock duration';
  end if;
  if (select prosrc from pg_proc where proname = 'notify_stale_lock_ins' and pronamespace = 'public'::regnamespace)
     !~ 'paused_at < now\(\) - interval ''3 hours''' then
    raise exception '0218: notify_stale_lock_ins has no pause cap';
  end if;

  -- Grants: the pair a client calls, and nothing it shouldn't.
  if not has_function_privilege('authenticated', 'public.pause_lock_in_session(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.resume_lock_in_session(uuid)', 'execute') then
    raise exception '0218: authenticated cannot pause/resume';
  end if;
  if has_function_privilege('anon', 'public.pause_lock_in_session(uuid)', 'execute')
     or has_function_privilege('anon', 'public.resume_lock_in_session(uuid)', 'execute') then
    raise exception '0218: anon can pause/resume';
  end if;
  if has_function_privilege('authenticated', 'public.lock_in_credited_seconds(lock_in_sessions, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.lock_in_credited_seconds(lock_in_sessions, timestamptz)', 'execute') then
    raise exception '0218: the credited-seconds formula is client-callable';
  end if;
end;
$post$;
