-- §F2 (server half) — put the subject's image on the push, and resolve that image automatically.
--
-- The native half is targets/notification-service (an iOS Notification Service Extension) and
-- needs a REBUILD. This half is what feeds it: the Expo push API's `richContent` field, which
-- Android renders out of the box and iOS renders via that extension.
--
-- notify_push gains a p_image_url. It is a NEW ARGUMENT, so the 5-arg version must be DROPPED
-- rather than replaced: CREATE OR REPLACE cannot change a function's argument list, and simply
-- adding a 6-arg overload would make every existing 5-arg call ambiguous ("function is not
-- unique") the moment the new parameter has a default. Third time this trap has come up in this
-- series of migrations; the drop is the whole fix.
--
-- Every existing caller passes 5 arguments and keeps working: the new parameter defaults to null,
-- which sends exactly the payload it sends today.

drop function if exists notify_push(uuid[], text, text, jsonb, text);

create function notify_push(
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
    -- richContent is only added when there IS an image. Expo sets `mutable-content: 1` on
    -- messages carrying it, which is what wakes the iOS extension; sending an empty object would
    -- wake the extension on every push to find nothing to do.
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

-- ───────────────────────────── leading art ─────────────────────────────

/**
 * The image that leads a notification, per the spec's "pull the image that matches the event"
 * table: the friend's avatar, the campfire's icon, the opponent's face — never the generic flame
 * when a real subject exists.
 *
 * Resolved from whatever the event already carries rather than from a per-type argument, so a
 * caller cannot forget to pass it and quietly fall back to the flame.
 *
 * Returns (url, shape). A null url is a legitimate answer — the client draws the flame — because
 * plenty of subjects have no picture: a user who never set an avatar, a campfire using an emoji.
 */
create or replace function notification_leading_art(
  p_type text,
  p_actor_id uuid,
  p_target_id uuid
)
returns table (url text, shape text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_category text := notification_category(p_type);
  v_url text;
begin
  -- An ACTOR is a person, and a person's face is the best possible leading art — it is the thing
  -- the recipient actually recognises. Checked first for every category that has one.
  if p_actor_id is not null then
    select pr.avatar_url into v_url from profiles pr where pr.id = p_actor_id;
    if v_url is not null then
      return query select v_url, 'circle'::text;
      return;
    end if;
  end if;

  -- Campfire events point at a group. Groups carry an emoji rather than an image today, so there
  -- is no URL to return — the shape is still 'rounded' so the client's flame fallback is masked
  -- as a campfire would be, and this starts working the day groups gain a banner.
  if v_category = 'campfires' and p_target_id is not null then
    return query select null::text, 'rounded'::text;
    return;
  end if;

  -- Rank and season events lead with the tier hexagon, which is drawn client-side from
  -- RANK_TIER_METAL rather than fetched — a generated shape, not an asset. Shape alone tells the
  -- client to draw it.
  if v_category = 'season_rank' then
    return query select null::text, 'hexagon'::text;
    return;
  end if;

  -- Streak events lead with the flame at the user's own heat, which is likewise drawn, not stored.
  if v_category = 'streak_reminders' then
    return query select null::text, 'flame'::text;
    return;
  end if;

  return query select null::text, 'flame'::text;
end;
$$;

-- notify_event now resolves the art when the caller did not supply one, and forwards the image to
-- the push so the OS notification and the in-app row lead with the SAME picture — the spec asks
-- for that explicitly ("same image in the bell feed, masked to shape").
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

  select coalesce(array_agg(p.id), '{}')
    into v_push_targets
  from profiles p
  where p.id = any(p_user_ids)
    and (p_actor_id is null or p.id <> p_actor_id)
    and coalesce((p.notification_prefs->>'master')::boolean, true)
    and coalesce((p.notification_prefs->>('cat_' || v_category))::boolean, v_push_default)
    and (p_type = 'daily_fire_reminder' or not is_in_quiet_hours(p.notification_prefs));

  if array_length(v_push_targets, 1) is not null then
    perform notify_push(
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

revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb) from public;
revoke all on function notify_event(uuid[], text, text, text, uuid, uuid, text, jsonb, text, text, jsonb) from authenticated;
