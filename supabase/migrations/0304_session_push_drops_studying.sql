-- 0304 — Gym Spark v2 §9 (de-study copy): the session-complete push stops saying "studying".
--
-- notify_session_complete labels the push by goal_type ("45 min in the gym", "30 min studying").
-- For a gym-first app the study arm now reads "locked in", the same neutral word the else-arm uses.
-- Nothing else changes.
--
-- RESTATED FROM LIVE, NOT FROM A MIGRATION FILE: the body below is pg_get_functiondef() of the
-- prod function as of 2026-11-17 with that ONE case arm edited. The guard refuses to run if the
-- live body has moved since (a sibling restated it), so this can never silently revert their work.

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.notify_session_complete'::regproc)
       <> '54b3614d77a162fcd36bac25682ef3ec' then
    raise exception '0304: notify_session_complete changed since this was authored — re-derive from live';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.notify_session_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seconds int;
  v_minutes int;
  v_xp numeric;
  v_streak int;
  v_label text;
  v_body text;
  v_score numeric;
  v_to_next numeric;
  v_next_tier text;
  v_next_division int;
  v_next_label text;
  -- 0289 · you + your people, in place of "N XP to <next rank>".
  v_my_week bigint;
  v_people_week bigint;
begin
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then
    return new;
  end if;

  select ci.duration_seconds, ci.xp_earned
    into v_seconds, v_xp
  from check_ins ci
  where ci.id = new.ended_check_in_id;

  v_minutes := coalesce(
    round(v_seconds / 60.0),
    round(extract(epoch from (new.last_confirmed_at - new.started_at)) / 60.0)
  )::int;

  -- A sub-minute session is a mis-tap, not an achievement. Still flips status, still counts
  -- everywhere else — it just does not earn a congratulatory push.
  if coalesce(v_minutes, 0) < 1 then return new; end if;

  select p.current_streak into v_streak from profiles p where p.id = new.user_id;

  v_label := case new.goal_type
    when 'gym' then 'in the gym'
    when 'study' then 'locked in'
    when 'run' then 'on a run'
    when 'read' then 'reading'
    when 'job_applications' then 'on applications'
    else 'locked in'
  end;

  v_body := format('%s min %s', v_minutes, v_label);
  if coalesce(v_xp, 0) > 0 then
    v_body := v_body || format(' · +%s XP', round(v_xp));
  end if;

  -- 0289 · CONNECTION-FIRST. The "N XP to <next rank>" clause is gone: a session-complete push
  -- says what you did, where your week stands, and what your people did together — never a rank.
  if coalesce(v_streak, 0) > 1 then
    v_body := v_body || format(' · %s-day streak', v_streak);
  end if;

  -- Same count as get_my_week_vs_last (0281): this week's manual check-ins, Sunday-anchored.
  select coalesce(sum(ci.duration_seconds), 0)
    into v_my_week
  from check_ins ci
  where ci.user_id = new.user_id
    and ci.removed_at is null
    and ci.duration_seconds > 0
    and coalesce(ci.source, 'manual') = 'manual'
    and ci.created_at >= week_start();

  -- The collective (0288). Never allowed to fail a session ending: on any error it is just absent.
  begin
    select s.out_this_week_seconds into v_people_week from people_week_stats(new.user_id) s;
  exception when others then
    v_people_week := null;
  end;

  if coalesce(v_my_week, 0) >= 3600 then
    v_body := v_body || format('. %sh %sm this week', v_my_week / 3600, (v_my_week % 3600) / 60);
  end if;
  if coalesce(v_people_week, 0) >= 3600 then
    v_body := v_body || format('. Your people logged %s hrs together.',
                               to_char(v_people_week / 3600, 'FM999,999,999'));
  else
    v_body := v_body || '. Nice work.';
  end if;

  perform notify_event(
    array[new.user_id], 'session_complete',
    format('🔥 Locked in for %s min', v_minutes),
    v_body,
    null, new.id,
    '/(tabs)', '{}'::jsonb,
    null, 'flame',
    jsonb_build_object('minutes', v_minutes, 'xp', round(coalesce(v_xp, 0)),
                       'streak', coalesce(v_streak, 0), 'goal_type', new.goal_type,
                       -- 0289 · the rank keys stay in the payload, null — the shape an installed
                       -- build already handles at the top of the climb — so no row shows a rank.
                       'xp_to_next_rank', null::numeric,
                       'next_rank', null::text,
                       'week_seconds', v_my_week,
                       'people_week_seconds', v_people_week)
  );

  return new;
end;
$function$;

do $$
declare v_src text := (select prosrc from pg_proc where oid = 'public.notify_session_complete'::regproc);
begin
  if position('then ' || chr(39) || 'studying' || chr(39) in v_src) > 0 then
    raise exception '0304: the studying label is still there';
  end if;
  if position('when ' || chr(39) || 'study' || chr(39) || ' then ' || chr(39) || 'locked in' || chr(39) in v_src) = 0 then
    raise exception '0304: the new study arm is missing';
  end if;
end;
$$;
