-- 0199 — A goal counts from the moment it was set, not from the start of its period.
--
-- DECIDED (Noah, 2026-09-21): a new goal must not back-credit progress from before it existed.
--
-- The repro: a personal weekly 10,000-step goal was created at 00:31:36.028 UTC and completed at
-- 00:31:36.329 — three tenths of a second later — off one Health Connect log of 19,779 steps. That
-- was the whole week so far, because a weekly goal's window opens at period_start (Sunday 00:00
-- UTC) and the very first sync credited everything in it. The goal was "complete" before its owner
-- had taken a step towards it, and a celebration fired over a card still reading 0/10,000.
--
-- The effective start of a goal's window is now max(period_start, created_at):
--   · in the period the goal was CREATED in, it counts from creation;
--   · in every later period, period_start is the later of the two and the full period counts —
--     so nothing changes for an established goal.
--
-- The device paths (steps, sleep) compute their window on the client and are fixed there
-- (fitness-challenge-sync.ts). Strava and Whoop compute theirs in their Edge Functions, fixed in
-- the same change. This migration is the third path: study and gym goals, credited from the
-- owner's own lock-ins here. A "10 hours of study this week" goal set on Thursday was absorbing
-- Monday's lock-ins exactly the same way.
--
-- Restated from the LIVE body (pg_get_functiondef on prod), not from 0068 — the only edit is the
-- window, and it is applied to both reads so the delta stays like-for-like.

create or replace function public.sync_challenge_from_lock_ins(p_challenge_id uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_challenge challenges;
  v_note text := 'Auto-synced from your lock-ins';
  v_goal_type text;
  v_total numeric;
  v_already numeric;
  v_delta numeric;
  v_since timestamptz;
begin
  select * into v_challenge
  from challenges
  where id = p_challenge_id and user_id = auth.uid();

  if v_challenge.id is null then
    raise exception 'Challenge not found.';
  end if;
  if v_challenge.completed_at is not null then
    return 0;
  end if;

  v_goal_type := case v_challenge.type
    when 'study_hours' then 'study'
    when 'gym_visits' then 'gym'
    else null
  end;
  if v_goal_type is null then
    return 0;
  end if;

  -- 0199 — the window opens at the LATER of the period start and the goal's own creation, so a goal
  -- set mid-period does not inherit the lock-ins that happened before it existed.
  v_since := greatest(v_challenge.period_start::timestamptz, v_challenge.created_at);

  select
    case
      -- Hours, not seconds: the challenge's unit is hours, so the conversion belongs here rather
      -- than in the client where it could drift from the target's unit.
      when v_challenge.type = 'study_hours' then coalesce(sum(ci.duration_seconds), 0) / 3600.0
      else count(*)
    end
    into v_total
  from check_ins ci
  where ci.user_id = v_challenge.user_id
    and ci.goal_type = v_goal_type
    and ci.removed_at is null
    and ci.created_at >= v_since
    and ci.created_at <= now()
    and check_in_qualifies_for_challenge(ci.id);

  -- Scoped to the same window, exactly like syncStepsFromDevice: a daily goal resets, so an
  -- all-time sum of prior logs would exceed today's total and drive the delta negative.
  select coalesce(sum(amount), 0) into v_already
  from challenge_logs
  where challenge_id = p_challenge_id
    and note = v_note
    and created_at >= v_since;

  v_delta := coalesce(v_total, 0) - v_already;
  -- Study hours are fractional; rounding to 2dp stops float noise logging 0.0000001-hour entries.
  if v_challenge.type = 'study_hours' then
    v_delta := round(v_delta, 2);
  end if;

  if v_delta <= 0 then
    return 0;
  end if;

  perform log_challenge_progress(p_challenge_id, v_delta, v_note);
  return v_delta;
end;
$function$;

do $assert$
begin
  if (select prosrc from pg_proc where proname = 'sync_challenge_from_lock_ins') !~ 'greatest\(v_challenge\.period_start::timestamptz, v_challenge\.created_at\)' then
    raise exception '0199: sync_challenge_from_lock_ins does not carry the creation baseline';
  end if;
end;
$assert$;
