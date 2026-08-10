-- study_hours and gym_visits auto-update from the user's OWN lock-ins.
--
-- Both were dead metrics: syncChallengeFromDevice only routed steps→pedometer, run/ride→Strava and
-- workout/strain/sleep→Whoop, so a study or gym goal sat at zero unless it was logged by hand —
-- even though the app already records exactly the check-ins that should credit them.
--
-- ANTI-CHEESE IS NOT BYPASSED. Both sums run through check_in_qualifies_for_challenge, which
-- requires ≥20 minutes and, for gym specifically, a photo or logged sets. A bare gym timer with
-- nothing to show for it must never count as a visit.

/**
 * Credits a lock-in-sourced challenge from qualifying check-ins in [period_start, now].
 *
 * DELTA-TRACKED rather than assigning progress outright. A plain `progress = <sum>` is idempotent
 * in isolation, but challenges.progress is shared with the manual-log path — overwriting it would
 * silently erase anything the user logged by hand, and this metric is one people DO log manually
 * (a library session on a dead phone). Logging the difference through log_challenge_progress
 * instead reuses the completion timestamp + campfire feed event, stays idempotent because the
 * total is recomputed from source every call, and leaves manual entries intact.
 *
 * Note-tagged with its own source string, the same mechanism the steps/Strava/Whoop syncs use to
 * read back what they specifically have already contributed.
 */
drop function if exists sync_challenge_from_lock_ins(uuid);
create function sync_challenge_from_lock_ins(p_challenge_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge challenges;
  v_note text := 'Auto-synced from your lock-ins';
  v_goal_type text;
  v_total numeric;
  v_already numeric;
  v_delta numeric;
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
    and ci.created_at >= v_challenge.period_start
    and ci.created_at <= now()
    and check_in_qualifies_for_challenge(ci.id);

  -- Scoped to the current period, exactly like syncStepsFromDevice: a daily goal resets, so an
  -- all-time sum of prior logs would exceed today's total and drive the delta negative.
  select coalesce(sum(amount), 0) into v_already
  from challenge_logs
  where challenge_id = p_challenge_id
    and note = v_note
    and created_at >= v_challenge.period_start;

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
$$;
