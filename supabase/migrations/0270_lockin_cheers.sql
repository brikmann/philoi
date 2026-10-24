-- LOCK-IN CHEERS + SESSION-SCOPED MESSAGES (CODE_PROMPT_lockin_cheers, mock 298).
--
-- A support layer for whoever is locked in RIGHT NOW. While a friend has a live session you can
-- cheer them (a fixed preset, once per session of theirs) or, if you are live too, trade a short
-- message. It is deliberately not a messaging product:
--
--   * "Live" = an un-ended lock_in_sessions row (status = 'active'; paused still counts, the
--     session has not ended). Presence is friends-only (accepted friend_requests) and respects
--     show_live_status in BOTH directions: someone who hides their live status neither appears
--     nor sees anyone else. show_live_activity hides what they are doing, not that they are live.
--   * A cheer needs only the RECIPIENT to be live. It is keyed to the recipient's session, which
--     is the 1/friend/session rate limit (unique (from_user, session_id)).
--   * A message needs BOTH to be live. A thread is the messages exchanged between one live session
--     of each — when either ends, the next pair of sessions starts a blank thread, and the old one
--     is unreadable: get_lockin_thread returns nothing and the SELECT policy refuses the rows.
--     No inbox, no history. Rows are deleted after two days by the cron job at the bottom.
--   * Blocks are respected everywhere (is_blocked_either_way / blocked_users).
--   * Push goes through notify_event, so the master/category switches and the #150 per-type gate
--     (type_lockin_cheer, type_lockin_message) apply. Both types fall to notification_category's
--     else-arm = friends_social; notification_category is not restated here on purpose (parallel
--     branches restate it — see parallel_agents_clobber_replaced_functions). A message pushes only
--     when it is the first unread one from that sender in the thread, and never carries the text:
--     notification_events is a feed that outlives the session.
--   * Report path = moderation_reports (0001/0252) with a server-side snapshot of the open thread.
--
-- Writes are RPC-only (security definer). Clients get SELECT on their own rows, which is what
-- Realtime postgres_changes needs to deliver INSERTs addressed to them.
--
-- LEDGER: 0270. 0262/0263 = philoi-app-3a, 0264–0269 = philoi-app-05's House bundle. NO db push
-- (it would also apply 0236 and anything unapplied in between). Apply this one file, then
-- `supabase migration repair --status applied 0270`.

begin;

-- ═══════════════════════════════ tables ═══════════════════════════════

create table if not exists public.lockin_cheers (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references public.profiles(id) on delete cascade,
  to_user     uuid not null references public.profiles(id) on delete cascade,
  -- The RECIPIENT's live session. One cheer per sender per session of theirs.
  session_id  uuid not null references public.lock_in_sessions(id) on delete cascade,
  preset      text not null check (preset in
                ('lock_in', 'lets_go', 'respect', 'keep_going', 'for_the_house', 'proud_of_you')),
  created_at  timestamptz not null default now(),
  constraint lockin_cheers_not_self check (from_user <> to_user),
  constraint lockin_cheers_one_per_session unique (from_user, session_id)
);

create index if not exists lockin_cheers_to_session_idx on public.lockin_cheers (session_id, created_at);
create index if not exists lockin_cheers_to_user_idx on public.lockin_cheers (to_user, created_at);

create table if not exists public.lockin_messages (
  id              uuid primary key default gen_random_uuid(),
  from_user       uuid not null references public.profiles(id) on delete cascade,
  to_user         uuid not null references public.profiles(id) on delete cascade,
  from_session_id uuid not null references public.lock_in_sessions(id) on delete cascade,
  to_session_id   uuid not null references public.lock_in_sessions(id) on delete cascade,
  body            text not null check (char_length(btrim(body)) between 1 and 140),
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  constraint lockin_messages_not_self check (from_user <> to_user)
);

create index if not exists lockin_messages_to_idx on public.lockin_messages (to_user, to_session_id, from_session_id);
create index if not exists lockin_messages_from_idx on public.lockin_messages (from_user, from_session_id, to_session_id);
create index if not exists lockin_messages_created_idx on public.lockin_messages (created_at);

-- ═══════════════════════════════ helpers ═══════════════════════════════

-- The live session a user can be reached on, or null. "Reachable" = an active session, live status
-- shown, account not disabled. The single definition every RPC below uses.
create or replace function public.lockin_reachable_session(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from lock_in_sessions s
    join profiles p on p.id = s.user_id
   where s.user_id = p_user
     and s.status = 'active'
     and coalesce(p.show_live_status, true)
     and not coalesce(p.is_disabled, false)
   limit 1;
$$;

revoke all on function public.lockin_reachable_session(uuid) from public, anon, authenticated;

-- Whether a message's thread is still open: both of its sessions un-ended. Used by the SELECT
-- policy, which runs as the querying role, so it needs an authenticated grant (see
-- rls_policy_functions_need_authenticated_grant). It reveals only whether two session ids are
-- both active, and the policy only ever asks about rows the caller is a party to.
create or replace function public.lockin_thread_is_open(p_from_session uuid, p_to_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from lock_in_sessions s
           where s.id in (p_from_session, p_to_session) and s.status = 'active') = 2;
$$;

revoke all on function public.lockin_thread_is_open(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lockin_thread_is_open(uuid, uuid) to authenticated;

-- ═══════════════════════════════ RLS ═══════════════════════════════

alter table public.lockin_cheers enable row level security;
alter table public.lockin_messages enable row level security;

revoke all on public.lockin_cheers from public, anon, authenticated;
revoke all on public.lockin_messages from public, anon, authenticated;
grant select on public.lockin_cheers to authenticated;
grant select on public.lockin_messages to authenticated;

drop policy if exists "lockin_cheers: read own" on public.lockin_cheers;
create policy "lockin_cheers: read own" on public.lockin_cheers
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists "lockin_messages: read own open thread" on public.lockin_messages;
create policy "lockin_messages: read own open thread" on public.lockin_messages
  for select to authenticated
  using (
    (from_user = auth.uid() or to_user = auth.uid())
    and lockin_thread_is_open(from_session_id, to_session_id)
  );

-- Realtime: an INSERT addressed to you reaches your open lock-in/home screen without polling.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lockin_cheers') then
    alter publication supabase_realtime add table public.lockin_cheers;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lockin_messages') then
    alter publication supabase_realtime add table public.lockin_messages;
  end if;
end $$;

-- ═══════════════════════════════ reads ═══════════════════════════════

-- Friends who are live right now. Drives the Home strip and the timer cluster. Empty when the
-- caller hides their own live status. out_ prefixes keep RETURNS TABLE from shadowing columns.
drop function if exists public.get_friends_locked_in();
create function public.get_friends_locked_in()
returns table (
  out_user_id      uuid,
  out_display_name text,
  out_handle       text,
  out_avatar_url   text,
  out_goal_type    text,
  out_category     text,
  out_activity     text,
  out_started_at   timestamptz,
  out_paused       boolean,
  out_i_cheered    boolean,
  out_unread       integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_my_session uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  if not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    return;
  end if;

  v_my_session := lockin_reachable_session(v_me);

  return query
  with f as (
    select case when fr.requester_id = v_me then fr.recipient_id else fr.requester_id end as fid
      from friend_requests fr
     where fr.status = 'accepted'
       and (fr.requester_id = v_me or fr.recipient_id = v_me)
  )
  select t.id,
         t.display_name,
         t.handle,
         t.avatar_url,
         case when coalesce(t.show_live_activity, true) then s.goal_type end,
         case when coalesce(t.show_live_activity, true) then s.category end,
         case when coalesce(t.show_live_activity, true) then s.activity end,
         s.started_at,
         s.paused,
         exists (select 1 from lockin_cheers c where c.from_user = v_me and c.session_id = s.id),
         case when v_my_session is null then 0 else
           (select count(*)::int from lockin_messages m
             where m.to_user = v_me and m.from_user = t.id
               and m.to_session_id = v_my_session and m.from_session_id = s.id
               and m.read_at is null)
         end
    from (select distinct fid from f) ff
    join profiles t on t.id = ff.fid
    join lock_in_sessions s on s.user_id = t.id and s.status = 'active'
   where coalesce(t.show_live_status, true)
     and not coalesce(t.is_disabled, false)
     and not exists (
       select 1 from blocked_users b
        where (b.blocker_id = v_me and b.blocked_id = t.id)
           or (b.blocker_id = t.id and b.blocked_id = v_me))
   order by s.started_at asc;
end;
$$;

revoke all on function public.get_friends_locked_in() from public, anon, authenticated;
grant execute on function public.get_friends_locked_in() to authenticated;

-- Cheers received on the caller's current session: the tally under the timer and the source of
-- the inbound banners. Empty when the caller is not live.
drop function if exists public.get_my_lockin_cheers();
create function public.get_my_lockin_cheers()
returns table (
  out_id           uuid,
  out_from_user    uuid,
  out_display_name text,
  out_handle       text,
  out_avatar_url   text,
  out_preset       text,
  out_created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.from_user, p.display_name, p.handle, p.avatar_url, c.preset, c.created_at
    from lock_in_sessions s
    join lockin_cheers c on c.session_id = s.id
    join profiles p on p.id = c.from_user
   where s.user_id = auth.uid()
     and s.status = 'active'
     and not exists (
       select 1 from blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = c.from_user)
           or (b.blocker_id = c.from_user and b.blocked_id = auth.uid()))
   order by c.created_at asc;
$$;

revoke all on function public.get_my_lockin_cheers() from public, anon, authenticated;
grant execute on function public.get_my_lockin_cheers() to authenticated;

-- The open thread with one friend, oldest first, and marks what they sent you as read. Returns
-- nothing — the thread is closed — unless both of you are live right now.
drop function if exists public.get_lockin_thread(uuid);
create function public.get_lockin_thread(p_with_user uuid)
returns table (
  out_id         uuid,
  out_from_me    boolean,
  out_body       text,
  out_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_mine uuid;
  v_theirs uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  v_mine := lockin_reachable_session(v_me);
  v_theirs := lockin_reachable_session(p_with_user);
  if v_mine is null or v_theirs is null or not is_friend_of(p_with_user)
     or is_blocked_either_way(p_with_user) then
    return;
  end if;

  update lockin_messages m
     set read_at = now()
   where m.to_user = v_me and m.from_user = p_with_user
     and m.to_session_id = v_mine and m.from_session_id = v_theirs
     and m.read_at is null;

  return query
  select m.id, m.from_user = v_me, m.body, m.created_at
    from lockin_messages m
   where (m.from_user = v_me and m.to_user = p_with_user
          and m.from_session_id = v_mine and m.to_session_id = v_theirs)
      or (m.from_user = p_with_user and m.to_user = v_me
          and m.from_session_id = v_theirs and m.to_session_id = v_mine)
   order by m.created_at asc;
end;
$$;

revoke all on function public.get_lockin_thread(uuid) from public, anon, authenticated;
grant execute on function public.get_lockin_thread(uuid) to authenticated;

-- ═══════════════════════════════ writes ═══════════════════════════════

-- Cheer a live friend. Returns true when sent, false when you already cheered this session of
-- theirs (the client shows ✓ either way). Does not need the sender to be live.
drop function if exists public.send_cheer(uuid, text);
create function public.send_cheer(p_to_user uuid, p_preset text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_session uuid;
  v_id uuid;
  v_name text;
  v_avatar text;
  v_label text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_to_user is null or p_to_user = v_me then
    raise exception 'You can''t cheer yourself.';
  end if;

  v_label := case p_preset
    when 'lock_in'       then '🔥 Lock in'
    when 'lets_go'       then '💪 Let''s go'
    when 'respect'       then '🫡 Respect'
    when 'keep_going'    then '⚡ Keep going'
    when 'for_the_house' then '🏛 For the house'
    when 'proud_of_you'  then '👑 Proud of you'
  end;
  if v_label is null then
    raise exception 'Unknown cheer.';
  end if;

  if not is_friend_of(p_to_user) or is_blocked_either_way(p_to_user) then
    raise exception 'You can only cheer friends.';
  end if;
  if not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    raise exception 'Turn on your live status to cheer friends.';
  end if;

  v_session := lockin_reachable_session(p_to_user);
  if v_session is null then
    raise exception 'They just finished their session.';
  end if;

  insert into lockin_cheers (from_user, to_user, session_id, preset)
  values (v_me, p_to_user, v_session, p_preset)
  on conflict (from_user, session_id) do nothing
  returning id into v_id;

  if v_id is null then
    return false;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), p.handle), p.avatar_url
    into v_name, v_avatar
    from profiles p where p.id = v_me;

  perform notify_event(
    array[p_to_user],
    'lockin_cheer',
    coalesce(v_name, 'A friend') || ' cheered you on',
    v_label,
    v_me,
    v_id,
    -- Home: on every installed build, and it offers "Return to your lock-in".
    '/(tabs)',
    '{}'::jsonb,
    v_avatar,
    'circle',
    jsonb_build_object('preset', p_preset)
  );

  return true;
end;
$$;

revoke all on function public.send_cheer(uuid, text) from public, anon, authenticated;
grant execute on function public.send_cheer(uuid, text) to authenticated;

-- Send a line into the open thread. Both sides must be live. Returns the new message id.
drop function if exists public.send_lockin_message(uuid, text);
create function public.send_lockin_message(p_to_user uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_mine uuid;
  v_theirs uuid;
  v_id uuid;
  v_first_unread boolean;
  v_replying boolean;
  v_name text;
  v_avatar text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_to_user is null or p_to_user = v_me then
    raise exception 'You can''t message yourself.';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'Say something first.';
  end if;
  if char_length(v_body) > 140 then
    raise exception 'Keep it under 140 characters.';
  end if;
  if not is_friend_of(p_to_user) or is_blocked_either_way(p_to_user) then
    raise exception 'You can only message friends.';
  end if;

  v_mine := lockin_reachable_session(v_me);
  if v_mine is null then
    raise exception 'Lock in to message — threads only run while you''re both live.';
  end if;
  v_theirs := lockin_reachable_session(p_to_user);
  if v_theirs is null then
    raise exception 'They just finished their session.';
  end if;

  -- A light thread, not a firehose: 60 lines a session pair, one every two seconds.
  if (select count(*) from lockin_messages m
       where m.from_user = v_me and m.from_session_id = v_mine and m.to_session_id = v_theirs) >= 60 then
    raise exception 'That''s a lot of messages — back to the grind.';
  end if;
  if exists (select 1 from lockin_messages m
              where m.from_user = v_me and m.from_session_id = v_mine
                and m.created_at > now() - interval '2 seconds') then
    raise exception 'Slow down a second.';
  end if;

  v_first_unread := not exists (
    select 1 from lockin_messages m
     where m.from_user = v_me and m.to_user = p_to_user
       and m.from_session_id = v_mine and m.to_session_id = v_theirs
       and m.read_at is null);
  v_replying := exists (
    select 1 from lockin_messages m
     where m.from_user = p_to_user and m.to_user = v_me
       and m.from_session_id = v_theirs and m.to_session_id = v_mine);

  insert into lockin_messages (from_user, to_user, from_session_id, to_session_id, body)
  values (v_me, p_to_user, v_mine, v_theirs, v_body)
  returning id into v_id;

  if v_first_unread then
    select coalesce(nullif(btrim(p.display_name), ''), p.handle), p.avatar_url
      into v_name, v_avatar
      from profiles p where p.id = v_me;

    perform notify_event(
      array[p_to_user],
      'lockin_message',
      coalesce(v_name, 'A friend') || case when v_replying then ' replied' else ' sent you a message' end,
      -- Never the text: this row outlives the thread.
      'Open your lock-in to read it.',
      v_me,
      v_id,
      '/(tabs)',
      '{}'::jsonb,
      v_avatar,
      'circle',
      '{}'::jsonb
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.send_lockin_message(uuid, text) from public, anon, authenticated;
grant execute on function public.send_lockin_message(uuid, text) to authenticated;

-- Report the open thread with a friend. Snapshots it server-side, since the rows stop being
-- readable (and are later deleted) once either session ends.
drop function if exists public.report_lockin_thread(uuid, text, text);
create function public.report_lockin_thread(p_with_user uuid, p_reason text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_snapshot jsonb;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_with_user is null or p_with_user = v_me then
    raise exception 'Nothing to report.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'from_user', m.from_user, 'to_user', m.to_user, 'body', m.body, 'created_at', m.created_at)
           order by m.created_at), '[]'::jsonb)
    into v_snapshot
    from lockin_messages m
   where ((m.from_user = v_me and m.to_user = p_with_user)
       or (m.from_user = p_with_user and m.to_user = v_me))
     and m.created_at > now() - interval '24 hours';

  insert into moderation_reports (reporter_id, reported_user_id, reason, note, reported_content_snapshot)
  values (
    v_me,
    p_with_user,
    case when p_reason in ('Spam or misleading', 'Harassment or bullying',
                           'Inappropriate or offensive content', 'Child safety / CSAE', 'Other')
         then p_reason else 'Other' end,
    left(coalesce(p_note, ''), 500),
    jsonb_build_object('kind', 'lockin_thread', 'messages', v_snapshot)
  );
end;
$$;

revoke all on function public.report_lockin_thread(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_lockin_thread(uuid, text, text) to authenticated;

-- ═══════════════════════════════ expiry ═══════════════════════════════

create or replace function public.expire_lockin_cheers()
returns void
language sql
security definer
set search_path = public
as $$
  delete from lockin_messages where created_at < now() - interval '2 days';
  delete from lockin_cheers where created_at < now() - interval '30 days';
$$;

revoke all on function public.expire_lockin_cheers() from public, anon, authenticated;

select cron.unschedule('philoi-lockin-cheers-expire')
 where exists (select 1 from cron.job where jobname = 'philoi-lockin-cheers-expire');
select cron.schedule('philoi-lockin-cheers-expire', '23 4 * * *',
                     $cron$select expire_lockin_cheers();$cron$);

commit;
