-- Settings §19 gaps: (1) "Who can see my photos" gains a third option — "Just me" (private
-- journal), alongside Everyone / My campfires. (2) Notifications become real per-category
-- toggles that actually gate delivery, not just a link to OS settings.

-- ─────────────────────────── Photo visibility: add 'private' ───────────────────────────
-- 'private' = the photo grid is a private journal: nobody but the owner sees it. The read
-- gate in get_user_lock_in_photos() already returns nothing unless visibility is 'everyone'
-- or ('campfires' + circle-mate), so 'private' needs no change there — it just falls through
-- to "not allowed" for everyone except the owner (who is short-circuited to allowed). The
-- around-campfire feed (get_group_feed / profile grid) keys off = 'everyone' the same way.
alter table profiles drop constraint if exists profiles_photo_visibility_check;
alter table profiles
  add constraint profiles_photo_visibility_check
  check (photo_visibility in ('everyone', 'campfires', 'private'));

create or replace function set_my_photo_visibility(p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visibility not in ('everyone', 'campfires', 'private') then
    raise exception 'Invalid photo visibility.';
  end if;

  update profiles
  set photo_visibility = p_visibility
  where id = auth.uid();
end;
$$;

-- ─────────────────────── Notification preferences (§19 grouped toggles) ───────────────────────
-- Per-category on/off + a master switch, stored as jsonb. Empty '{}' default = everything on
-- (every reader coalesces a missing key to true), so existing users keep today's behavior
-- until they change something. Keys map to the notification `type` in each push's data payload:
--   campfire_lockins → check_in        reactions      → reaction
--   messages         → message/chat_batch/mention      campfire_cold  → lockin_still_here
--   streak_risk      → streak_risk     challenges     → challenge_invite/challenge_completed
-- Transactional/system pushes with no category (join_request, join_request_approved, test)
-- are never suppressed.
alter table profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

create or replace function set_my_notification_prefs(p_prefs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set notification_prefs = coalesce(p_prefs, '{}'::jsonb)
  where id = auth.uid();
end;
$$;

-- notify_push now drops recipients who've muted this push's category. The category is derived
-- from data->>'type'; a null category (unmapped type) is always delivered. A recipient is
-- kept only if master is on AND that category's flag is on (both default true when absent).
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
