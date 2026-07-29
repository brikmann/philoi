-- Notification quiet hours (PHILOI_UI_SPEC.md §19) — the second half of "master toggle +
-- optional quiet hours." Enforced server-side against the RECIPIENT'S local time, so it needs
-- their timezone: the client stows an IANA zone (e.g. 'America/Toronto') inside notification_prefs
-- whenever it saves. Quiet-hours config also lives in notification_prefs:
--   quiet_enabled boolean · quiet_start int (0–23) · quiet_end int (0–23) · timezone text
-- The window may wrap midnight (start 22, end 7). Missing/empty timezone falls back to UTC.

create or replace function is_in_quiet_hours(p_prefs jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when not coalesce((p_prefs->>'quiet_enabled')::boolean, false) then false
    when (p_prefs->>'quiet_start') is null or (p_prefs->>'quiet_end') is null then false
    else (
      select case
        when qs = qe then false                       -- zero-length window = never quiet
        when qs < qe then hr >= qs and hr < qe          -- same-day window
        else hr >= qs or hr < qe                        -- window wraps past midnight
      end
      from (
        select
          extract(hour from (now() at time zone coalesce(nullif(p_prefs->>'timezone', ''), 'UTC')))::int as hr,
          (p_prefs->>'quiet_start')::int as qs,
          (p_prefs->>'quiet_end')::int as qe
      ) t
    )
  end;
$$;

-- Fold quiet hours into notify_push's recipient filter: a categorized push (v_pref_key not
-- null) is also dropped for any recipient currently inside their quiet window. Transactional
-- pushes (null category) still always deliver.
create or replace function notify_push(
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_channel_id text default 'accountability'
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', p_title,
    'body', p_body,
    'data', p_data,
    'sound', 'default',
    'channelId', p_channel_id
  )), '[]'::jsonb)
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
