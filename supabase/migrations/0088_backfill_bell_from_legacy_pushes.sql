-- §F — make every EXISTING notification land in the bell, without rewriting twenty call sites.
--
-- 0086 built the feed and notify_event to fill it, but the app's twenty existing notifications are
-- spread across fifteen trigger functions in fourteen migrations, each calling notify_push
-- directly. Porting them one by one would mean reproducing fifteen function bodies verbatim in a
-- new migration — a large diff whose failure mode is a subtly mis-copied trigger, on paths as
-- load-bearing as check-ins and join requests.
--
-- So the layering is inverted instead. notify_push keeps its exact name and signature and becomes
-- "write the feed, then send"; the pure sender moves to notify_push_raw. Every legacy caller gains
-- a bell row for free, having changed nothing, and the risky rewrite never happens.
--
--   notify_push(...)   -> feed rows for ALL recipients, then notify_push_raw for the eligible ones
--   notify_event(...)  -> richer feed rows (actor, route, art), then notify_push_raw
--   notify_push_raw()  -> the sender, exactly what notify_push used to be
--
-- notify_event no longer routes through notify_push, which is what stops a doubled feed row.

-- ───────────────────────────── route mapping ─────────────────────────────

/**
 * Where a legacy notification should navigate, derived from the `{type, <entity>_id}` payload the
 * existing callers already build. Returns the route and its params.
 *
 * Every unmapped type returns a null route, and the feed row simply renders as non-tappable —
 * which is correct for the ones that have no single destination (a streak nudge is about the whole
 * app, not one screen) and safe for any type added later before its route is known.
 */
create or replace function notification_route_for(p_type text, p_data jsonb)
returns table (route text, params jsonb)
language sql
immutable
as $$
  select
    case p_type
      when 'challenge_invite'            then '/challenge-info/[challengeId]'
      when 'challenge_completed'         then '/challenge-info/[challengeId]'
      when 'challenge_forfeited'         then '/challenge-info/[challengeId]'
      when 'challenge_terms_updated'     then '/challenge-info/[challengeId]'
      when 'challenge_change_request'    then '/challenge-change/[requestId]'
      when 'challenge_change_answered'   then '/challenge-change/[requestId]'
      when 'join_request'                then '/group/[groupId]'
      when 'join_request_approved'       then '/group/[groupId]'
      when 'circle'                      then '/group/[groupId]'
      when 'check_in'                    then '/group/[groupId]'
      when 'message'                     then '/group/[groupId]'
      when 'lockin_still_here'           then '/group/[groupId]'
      else null
    end,
    coalesce(
      case p_type
        when 'challenge_change_request'  then jsonb_build_object('requestId', p_data->>'request_id')
        when 'challenge_change_answered' then jsonb_build_object('requestId', p_data->>'request_id')
        else
          case
            when p_data ? 'challenge_id' then jsonb_build_object('challengeId', p_data->>'challenge_id')
            when p_data ? 'group_id'     then jsonb_build_object('groupId', p_data->>'group_id')
            else null
          end
      end,
      '{}'::jsonb
    );
$$;

-- The legacy types predate notification_category's vocabulary, so map them too. Without this every
-- legacy row would fall to the 'friends_social' default and be muted by the wrong toggle.
create or replace function notification_category(p_type text)
returns text
language sql
immutable
as $$
  select case
    -- new pipeline types (0086)
    when p_type in ('friend_request', 'friend_accepted', 'friend_ranked_up', 'friend_passed_you',
                    'friend_joined', 'friend_locked_in') then 'friends_social'
    when p_type in ('challenged', 'challenge_accepted', 'challenge_declined', 'challenge_passed',
                    'challenge_ending_soon', 'challenge_won', 'challenge_lost', 'goal_at_risk',
                    'goal_streak_milestone') then 'challenges'
    when p_type in ('campfire_joined', 'campfire_join_request', 'campfire_challenge_started',
                    'campfire_cold', 'campfire_added', 'campfire_settled', 'campfire_message')
      then 'campfires'
    when p_type in ('streak_at_risk', 'daily_fire_reminder', 'streak_milestone') then 'streak_reminders'
    when p_type in ('season_ending', 'season_settled', 'ranked_up', 'rank_dropped', 'reward_ready')
      then 'season_rank'
    -- legacy types still emitted by the pre-0086 callers
    when p_type in ('challenge_invite', 'challenge_completed', 'challenge_forfeited',
                    'challenge_terms_updated', 'challenge_change_request',
                    'challenge_change_answered') then 'challenges'
    when p_type in ('check_in', 'message', 'circle', 'join_request', 'join_request_approved',
                    'lockin_still_here') then 'campfires'
    when p_type in ('streak_risk') then 'streak_reminders'
    when p_type in ('lock_in_nudge') then 'friends_social'
    else 'friends_social'
  end;
$$;

-- ───────────────────────────── the sender ─────────────────────────────

-- notify_push's body, verbatim, under a new name. Unchanged behaviour: the same pref gate, the
-- same quiet-hours check, the same richContent shape from 0087.
create or replace function notify_push_raw(
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_channel_id text default 'accountability',
  p_image_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
  v_pref_key text := case p_data->>'type'
    when 'check_in' then 'campfire_lockins'
    when 'reaction' then 'reactions'
    when 'message' then 'messages'
    when 'chat_batch' then 'messages'
    when 'mention' then 'messages'
    when 'lockin_still_here' then 'campfire_cold'
    when 'streak_risk' then 'streak_risk'
    when 'challenge_invite' then 'challenges'
    when 'challenge_completed' then 'challenges'
    else null
  end;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'to', t.token,
      'title', p_title,
      'body', p_body,
      'data', p_data,
      'sound', 'default',
      'channelId', p_channel_id
    )
    || case when p_image_url is null then '{}'::jsonb
            else jsonb_build_object('richContent', jsonb_build_object('image', p_image_url)) end
  ), '[]'::jsonb)
  into v_messages
  from push_tokens t
  join profiles p on p.id = t.user_id
  where t.user_id = any(p_user_ids)
    and (
      v_pref_key is null
      or (
        coalesce((p.notification_prefs->>'master')::boolean, true)
        and coalesce((p.notification_prefs->>v_pref_key)::boolean, true)
        and not is_in_quiet_hours(p.notification_prefs)
      )
    );

  if jsonb_array_length(v_messages) = 0 then
    return;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := v_messages
  );
end;
$$;

-- ───────────────────────────── notify_push becomes feed + send ─────────────────────────────

-- Same 6-arg signature as 0087, so CREATE OR REPLACE is safe and no caller changes.
create or replace function notify_push(
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_channel_id text default 'accountability',
  p_image_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := coalesce(p_data->>'type', 'system');
  v_actor uuid;
  v_target uuid;
  v_route record;
  v_art record;
begin
  -- Best-effort actor. Legacy payloads name it inconsistently, and a trigger has no auth.uid() to
  -- fall back on, so this is null more often than not — the feed row just leads with the flame.
  v_actor := nullif(coalesce(p_data->>'from_user_id', p_data->>'actor_id'), '')::uuid;
  v_target := nullif(coalesce(p_data->>'challenge_id', p_data->>'group_id', p_data->>'request_id'), '')::uuid;

  select * into v_route from notification_route_for(v_type, coalesce(p_data, '{}'::jsonb));
  select * into v_art from notification_leading_art(v_type, v_actor, v_target);

  -- The feed gets EVERY recipient, including those the push gate below will filter out. That is
  -- the spec's rule — a muted category still populates the bell — and it is what makes muting
  -- safe rather than lossy.
  insert into notification_events (
    user_id, type, category, actor_id, target_id, title, body,
    route, route_params, image_url, image_shape, payload
  )
  select
    u, v_type, notification_category(v_type), v_actor, v_target, p_title, nullif(p_body, ''),
    v_route.route, coalesce(v_route.params, '{}'::jsonb),
    coalesce(p_image_url, v_art.url), coalesce(v_art.shape, 'flame'),
    coalesce(p_data, '{}'::jsonb)
  from unnest(p_user_ids) as u
  where v_actor is null or u <> v_actor;

  perform notify_push_raw(p_user_ids, p_title, p_body, p_data, p_channel_id, coalesce(p_image_url, v_art.url));
end;
$$;

-- ───────────────────────────── notify_event sends directly ─────────────────────────────

-- Only one line changes from 0087: the push goes through notify_push_raw rather than notify_push,
-- because notify_event has already written its own (richer) feed rows and routing through the
-- wrapper above would write them a second time.
create or replace function notify_event(
  p_user_ids uuid[],
  p_type text,
  p_title text,
  p_body text default null,
  p_actor_id uuid default null,
  p_target_id uuid default null,
  p_route text default null,
  p_route_params jsonb default '{}'::jsonb,
  p_image_url text default null,
  p_image_shape text default null,
  p_payload jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
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

  select coalesce(array_agg(p.id), '{}')
    into v_push_targets
  from profiles p
  where p.id = any(p_user_ids)
    and (p_actor_id is null or p.id <> p_actor_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>('cat_' || v_category))::boolean, v_push_default)
    and (p_type = 'daily_fire_reminder' or not is_in_quiet_hours(p.notification_prefs));

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
$$;

revoke all on function notify_push_raw(uuid[], text, text, jsonb, text, text) from public;
revoke all on function notify_push_raw(uuid[], text, text, jsonb, text, text) from authenticated;
