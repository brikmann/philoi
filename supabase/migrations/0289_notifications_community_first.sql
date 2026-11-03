-- 0289 · NOTIFICATIONS, COMMUNITY-FIRST (connection-first restructure, Phase 2b).
--
-- A push lands on the lock screen whether or not anyone opens the app, so the copy IS the brand.
-- Every live event type was classified against prod (notification_events, 90 days):
--
--   community    friend_locked_in, check_in, lockin_cheer, friend_request/accepted,
--                friend_agora_post, campfire_*/forest_post, chat_batch, dm_received,
--                milestone_posted …                                           unchanged
--   ipsative     streak_risk, ranked_up (your own lifetime climb, 0230), reward_ready,
--                badge_earned, session_complete                               kept; see ③
--   opted-in     challenge_*, campfire_settled — you entered the race          unchanged
--   competition  daily_placement (354 sent in 90 days — the most-sent push in the app),
--                season_ending                                                gated; see ① ②
--   loss         rank_dropped, friend_passed_you, challenge_passed             never sent; see ①
--
-- ① notify_event — two gates, inserted after the empty-recipient check (pure insertion; the rest
--   is the live body verbatim, from pg_get_functiondef on 2026-11-03). Loss types return before
--   the bell row is written. Standing types keep only recipients with prefs.competition = true,
--   which is absent — so OFF — for everyone today: the switch ships in this build.
-- ② send_daily_placement — the same opt-in in both of its WHERE clauses, and positive-only copy:
--   a first placement or a climb sends; a hold or a slip sends nothing. "Defend it" and
--   "reclaim it" are gone.
-- ③ notify_session_complete — "N XP to Bronze II" becomes "2h 14m this week. Your people logged
--   5,042 hrs together." (people_week_stats, 0288). The payload's rank keys stay, null.
--
-- Bodies only: no signature, return type or grant changes, so CREATE OR REPLACE keeps every
-- grant and the lock_in_sessions_complete_push trigger as they are.

CREATE OR REPLACE FUNCTION public.notify_event(p_user_ids uuid[], p_type text, p_title text, p_body text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_target_id uuid DEFAULT NULL::uuid, p_route text DEFAULT NULL::text, p_route_params jsonb DEFAULT '{}'::jsonb, p_image_url text DEFAULT NULL::text, p_image_shape text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_category text := notification_category(p_type);
  v_push_default boolean := notification_push_default(p_type);
  v_written int := 0;
  v_push_targets uuid[];
  v_art record;
  v_url text;
  v_shape text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  -- 0289 · CONNECTION-FIRST. A loss notification never goes out — not the bell row, not the push,
  -- for anyone, whatever they've switched on: being passed or dropping a place is not news Philoi
  -- delivers. And a standing notification (where you place on a board, a season about to close)
  -- only reaches someone who opted into competition (prefs.competition, absent = off).
  if p_type in ('rank_dropped', 'friend_passed_you', 'challenge_passed') then
    return 0;
  end if;
  if p_type in ('daily_placement', 'season_ending') then
    select coalesce(array_agg(p.id), '{}')
      into p_user_ids
    from profiles p
    where p.id = any(p_user_ids)
      and coalesce((p.notification_prefs->>'competition')::boolean, false);
    if array_length(p_user_ids, 1) is null then
      return 0;
    end if;
  end if;

  -- An explicitly-passed image always wins; otherwise derive it. This is what lets a caller with
  -- something better than the subject's avatar (a rarity-coloured box) say so, while every other
  -- caller gets the right art for free.
  select * into v_art from notification_leading_art(p_type, p_actor_id, p_target_id);
  v_url := coalesce(p_image_url, v_art.url);
  v_shape := coalesce(p_image_shape, v_art.shape, 'flame');

  insert into notification_events (
    user_id, type, category, actor_id, target_id, title, body,
    route, route_params, image_url, image_shape, payload
  )
  select
    u, p_type, v_category, p_actor_id, p_target_id, p_title, p_body,
    p_route, coalesce(p_route_params, '{}'::jsonb), v_url, v_shape,
    coalesce(p_payload, '{}'::jsonb)
  from unnest(p_user_ids) as u
  where p_actor_id is null or u <> p_actor_id;

  get diagnostics v_written = row_count;

  -- THE ONE ADDED LINE. Everything above and below is 0087's.
  if coalesce(current_setting('philoi.suppress_push', true), 'off') = 'on' then
    return v_written;
  end if;

  select coalesce(array_agg(p.id), '{}')
    into v_push_targets
  from profiles p
  where p.id = any(p_user_ids)
    and (p_actor_id is null or p.id <> p_actor_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>('cat_' || v_category))::boolean, v_push_default)
    -- #150 · the per-type gate. Inserted ABOVE the quiet-hours line rather than appended to it,
    -- so this is a pure line insertion and the diff removes nothing.
    and coalesce((p.notification_prefs->>('type_' || p_type))::boolean, true)
    -- 0205 · daily_placement joins daily_fire_reminder: both are times the USER chose.
    and (p_type in ('daily_fire_reminder', 'daily_placement') or not is_in_quiet_hours(p.notification_prefs));

  if array_length(v_push_targets, 1) is not null then
    perform notify_push_raw(
      v_push_targets,
      p_title,
      coalesce(p_body, ''),
      jsonb_build_object('type', p_type, 'route', p_route, 'params', coalesce(p_route_params, '{}'::jsonb))
        || coalesce(p_payload, '{}'::jsonb),
      'accountability',
      v_url
    );
  end if;

  return v_written;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_daily_placement()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sent int := 0;
  r record;
  -- 0216 · movement
  v_prev  int;
  v_tier  text;
  v_title text;
  v_body  text;
  v_where text;
begin
  if not exists (
    select 1 from profiles p
    where not p.is_demo and not p.is_disabled
      -- 0217 · public only.
      and p.rank_visibility = 'public'
      -- 0253 · on a uni board.
      and p.university_email_verified and p.university is not null
      and coalesce((p.notification_prefs->>'master')::boolean, true)
      and coalesce((p.notification_prefs->>'placement_enabled')::boolean, true)
      -- 0289 · competition is opt-in. Without it there is no placement push at all.
      and coalesce((p.notification_prefs->>'competition')::boolean, false)
      and extract(hour from (now() at time zone
            coalesce(nullif(p.notification_prefs->>'timezone', ''), nullif(p.timezone, ''), 'UTC')))::int
          = coalesce((p.notification_prefs->>'placement_hour')::int, 21)
  ) then
    return 0;
  end if;

  for r in
    with board as (
      select
        p.id,
        row_number() over (partition by p.university order by season_score(p.id) desc, p.display_name asc)::int as rank,
        count(*) over (partition by p.university)::int as total
      from profiles p
      where not p.is_demo and not p.is_disabled
        and p.university_email_verified and p.university is not null
        and p.rank_visibility = 'public'
    )
    select b.id, b.rank, b.total
    from board b
    join profiles p on p.id = b.id
    where coalesce((p.notification_prefs->>'master')::boolean, true)
      -- 0217 · public only — friends and private get no placement push.
      and p.rank_visibility = 'public'
      and coalesce((p.notification_prefs->>'placement_enabled')::boolean, true)
      -- 0289 · competition is opt-in. Without it there is no placement push at all.
      and coalesce((p.notification_prefs->>'competition')::boolean, false)
      and extract(hour from (now() at time zone
            coalesce(nullif(p.notification_prefs->>'timezone', ''), nullif(p.timezone, ''), 'UTC')))::int
          = coalesce((p.notification_prefs->>'placement_hour')::int, 21)
      and not exists (
        select 1 from notification_events ne
        where ne.user_id = b.id
          and ne.type = 'daily_placement'
          and ne.created_at > now() - interval '23 hours'
      )
  loop
    -- 0216 · the last placement this user was sent. 0253 · only a uni one is comparable.
    v_prev := null;
    select case when ne.payload->>'rank' ~ '^[0-9]+$' then (ne.payload->>'rank')::int end
      into v_prev
    from notification_events ne
    where ne.user_id = r.id and ne.type = 'daily_placement'
      and ne.payload->>'scope' = 'uni'
    order by ne.created_at desc
    limit 1;

    -- 0289 · POSITIVE-ONLY. A climb is news; a slip or a hold is not — no "defend it", no
    -- "reclaim it", nothing sent. v_prev is the last placement this user was SENT, so after a
    -- quiet night the next push still reads against the last one they saw. v_tier stays declared
    -- and unused, so this remains a body-only edit.
    v_where := ' at your uni';

    if v_prev is null then
      v_title := 'You''re on your uni''s board at #' || to_char(r.rank, 'FM999,999,999') || ' 🔥';
      v_body  := 'That''s where you start. Every session moves it.';
    elsif v_prev > r.rank then
      v_title := 'You climbed to #' || to_char(r.rank, 'FM999,999,999') || v_where || ' 🔥';
      v_body  := 'Up from #' || to_char(v_prev, 'FM999,999,999') || '. Nice work.';
    else
      continue;
    end if;

    perform notify_event(
      array[r.id],
      'daily_placement',
      v_title,
      v_body,
      null,
      null,
      '/(tabs)/leaderboards',
      '{"scope": "uni"}'::jsonb,
      null,
      'flame',
      jsonb_strip_nulls(jsonb_build_object('scope', 'uni', 'rank', r.rank, 'total', r.total, 'prev_rank', v_prev))
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

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
    when 'study' then 'studying'
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
