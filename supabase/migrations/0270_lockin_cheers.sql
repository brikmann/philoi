-- LOCK-IN CHEERS + SESSION-SCOPED MESSAGES (CODE_PROMPT_lockin_cheers, mock 298).
--
-- A support layer for whoever is locked in RIGHT NOW. While a friend has a live session you can
-- cheer them (a fixed preset, once per session of theirs) or trade a short message — without
-- starting a session of your own. It is deliberately not a messaging product:
--
--   * "Live" = an un-ended lock_in_sessions row (status = 'active'; paused still counts, the
--     session has not ended). Presence is friends-only (accepted friend_requests) and respects
--     show_live_status in BOTH directions: someone who hides their live status neither appears
--     nor sees anyone else. show_live_activity hides what they are doing, not that they are live.
--   * A cheer needs only the RECIPIENT to be live. It is keyed to the recipient's session, which
--     is the 1/friend/session rate limit (unique (from_user, session_id)).
--   * A message STARTS only toward a friend who is live; the sender need not be. It lands in the
--     pair's one open lockin_threads row, which stays readable and repliable while AT LEAST ONE of
--     the two is live — so a reply back to a sender who isn't locked in is fine while the friend
--     they wrote to still is. When neither is live the thread closes (the trigger on
--     lock_in_sessions stamps closed_at the moment the last live session ends) and it is gone:
--     get_lockin_thread returns nothing and the SELECT policy refuses its rows. The next message
--     opens a blank thread. No inbox, no history; rows are deleted after two days (cron below).
--   * Blocks are respected everywhere (is_blocked_either_way / blocked_users).
--   * Push goes through notify_event, so the master/category switches and the #150 per-type gate
--     (type_lockin_cheer, type_lockin_message) apply. Both types fall to notification_category's
--     else-arm = friends_social; notification_category is not restated here on purpose (parallel
--     branches restate it — see parallel_agents_clobber_replaced_functions). A message pushes only
--     when it is the first unread one from that sender in the thread, and never carries the text:
--     notification_events is a feed that outlives the thread.
--   * Report path = moderation_reports (0001/0252) with a server-side snapshot of the thread.
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

-- One row per stretch of "at least one of us is live". user_a < user_b, so a pair has one key.
create table if not exists public.lockin_threads (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references public.profiles(id) on delete cascade,
  user_b     uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  constraint lockin_threads_ordered check (user_a < user_b)
);

-- At most one open thread per pair.
create unique index if not exists lockin_threads_one_open on public.lockin_threads (user_a, user_b)
  where closed_at is null;
create index if not exists lockin_threads_user_b_idx on public.lockin_threads (user_b) where closed_at is null;

create table if not exists public.lockin_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.lockin_threads(id) on delete cascade,
  from_user       uuid not null references public.profiles(id) on delete cascade,
  to_user         uuid not null references public.profiles(id) on delete cascade,
  -- Each side's live session at send time; null for a side that wasn't locked in. A record only —
  -- whether the thread is open is lockin_threads' job.
  from_session_id uuid references public.lock_in_sessions(id) on delete set null,
  to_session_id   uuid references public.lock_in_sessions(id) on delete set null,
  body            text not null check (char_length(btrim(body)) between 1 and 140),
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  constraint lockin_messages_not_self check (from_user <> to_user)
);

create index if not exists lockin_messages_thread_idx on public.lockin_messages (thread_id, created_at);
create index if not exists lockin_messages_to_idx on public.lockin_messages (to_user, thread_id) where read_at is null;
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

-- Whether a thread is open: not closed, and one of its two people still has an un-ended session.
-- The second half is belt and braces behind the closing trigger (a session deleted outright never
-- fires it). Used by the SELECT policy, which runs as the querying role, so it needs an
-- authenticated grant (see rls_policy_functions_need_authenticated_grant). It reveals only
-- whether a thread id is open, and the policy only ever asks about rows the caller is party to.
create or replace function public.lockin_thread_is_open(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from lockin_threads t
     where t.id = p_thread_id
       and t.closed_at is null
       and exists (select 1 from lock_in_sessions s
                    where s.user_id in (t.user_a, t.user_b) and s.status = 'active'));
$$;

revoke all on function public.lockin_thread_is_open(uuid) from public, anon, authenticated;
grant execute on function public.lockin_thread_is_open(uuid) to authenticated;

-- The pair's open thread id, or null.
create or replace function public.lockin_open_thread(p_x uuid, p_y uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id from lockin_threads t
   where t.user_a = least(p_x, p_y) and t.user_b = greatest(p_x, p_y)
     and lockin_thread_is_open(t.id)
   limit 1;
$$;

revoke all on function public.lockin_open_thread(uuid, uuid) from public, anon, authenticated;

-- Closes every thread whose LAST live participant just ended — by status change, or by the row
-- going away outright (goal_id cascades). Without the DELETE arm a missed close would revive the
-- old thread, messages and all, the next time either of them went live.
create or replace function public.lockin_close_threads_on_session_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := old.user_id;
begin
  if old.status = 'active' and (tg_op = 'DELETE' or new.status <> 'active') then
    update lockin_threads t
       set closed_at = now()
     where t.closed_at is null
       and (t.user_a = v_user or t.user_b = v_user)
       and not exists (
         select 1 from lock_in_sessions s
          where s.status = 'active'
            and s.id <> old.id
            and s.user_id = case when t.user_a = v_user then t.user_b else t.user_a end);
  end if;
  return null;
end;
$$;

revoke all on function public.lockin_close_threads_on_session_end() from public, anon, authenticated;

drop trigger if exists lock_in_sessions_close_lockin_threads on public.lock_in_sessions;
create trigger lock_in_sessions_close_lockin_threads
  after update of status or delete on public.lock_in_sessions
  for each row execute function public.lockin_close_threads_on_session_end();

-- ═══════════════════════════════ RLS ═══════════════════════════════

alter table public.lockin_cheers enable row level security;
alter table public.lockin_threads enable row level security;
alter table public.lockin_messages enable row level security;

revoke all on public.lockin_cheers from public, anon, authenticated;
revoke all on public.lockin_threads from public, anon, authenticated;
revoke all on public.lockin_messages from public, anon, authenticated;
grant select on public.lockin_cheers to authenticated;
grant select on public.lockin_messages to authenticated;
-- lockin_threads: no client grant. Everything about it reaches the client through the RPCs.

drop policy if exists "lockin_cheers: read own" on public.lockin_cheers;
create policy "lockin_cheers: read own" on public.lockin_cheers
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists "lockin_messages: read own open thread" on public.lockin_messages;
create policy "lockin_messages: read own open thread" on public.lockin_messages
  for select to authenticated
  using (
    (from_user = auth.uid() or to_user = auth.uid())
    and lockin_thread_is_open(thread_id)
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

-- Friends who are live right now, plus any friend you have an open thread with who isn't (you're
-- the live one, they wrote to you — you can still reply). Drives the Home strip and the timer
-- cluster. Empty when the caller hides their own live status. out_ prefixes keep RETURNS TABLE
-- from shadowing columns.
drop function if exists public.get_friends_locked_in();
create function public.get_friends_locked_in()
returns table (
  out_user_id      uuid,
  out_display_name text,
  out_handle       text,
  out_avatar_url   text,
  out_live         boolean,
  out_goal_type    text,
  out_category     text,
  out_activity     text,
  out_started_at   timestamptz,
  out_paused       boolean,
  out_i_cheered    boolean,
  out_thread_open  boolean,
  out_unread       integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  if not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    return;
  end if;

  return query
  with f as (
    select distinct case when fr.requester_id = v_me then fr.recipient_id else fr.requester_id end as fid
      from friend_requests fr
     where fr.status = 'accepted'
       and (fr.requester_id = v_me or fr.recipient_id = v_me)
  ),
  fr_rows as (
    select t.id as uid, t.display_name, t.handle, t.avatar_url,
           t.show_live_activity,
           s.id as session_id, s.goal_type, s.category, s.activity, s.started_at, s.paused,
           lockin_open_thread(v_me, t.id) as thread_id
      from f
      join profiles t on t.id = f.fid
      left join lock_in_sessions s on s.user_id = t.id and s.status = 'active'
     where coalesce(t.show_live_status, true)
       and not coalesce(t.is_disabled, false)
       and not exists (
         select 1 from blocked_users b
          where (b.blocker_id = v_me and b.blocked_id = t.id)
             or (b.blocker_id = t.id and b.blocked_id = v_me))
  )
  select r.uid,
         r.display_name,
         r.handle,
         r.avatar_url,
         r.session_id is not null,
         case when coalesce(r.show_live_activity, true) then r.goal_type end,
         case when coalesce(r.show_live_activity, true) then r.category end,
         case when coalesce(r.show_live_activity, true) then r.activity end,
         r.started_at,
         coalesce(r.paused, false),
         r.session_id is not null
           and exists (select 1 from lockin_cheers c where c.from_user = v_me and c.session_id = r.session_id),
         r.thread_id is not null,
         case when r.thread_id is null then 0 else
           (select count(*)::int from lockin_messages m
             where m.thread_id = r.thread_id and m.to_user = v_me and m.read_at is null)
         end
    from fr_rows r
   where r.session_id is not null or r.thread_id is not null
   order by (r.session_id is null), r.started_at asc nulls last;
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
-- nothing when there is no open thread (neither of you is live, or nobody has written yet).
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
  v_thread uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_with_user is null or p_with_user = v_me
     or not is_friend_of(p_with_user) or is_blocked_either_way(p_with_user)
     or not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    return;
  end if;

  v_thread := lockin_open_thread(v_me, p_with_user);
  if v_thread is null then
    return;
  end if;

  update lockin_messages m
     set read_at = now()
   where m.thread_id = v_thread and m.to_user = v_me and m.read_at is null;

  return query
  select m.id, m.from_user = v_me, m.body, m.created_at
    from lockin_messages m
   where m.thread_id = v_thread
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

-- Send a line. Starting (or restarting) a thread needs the RECIPIENT live; replying into the
-- pair's open thread needs only that it is still open (one of you is live). Returns the message id.
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
  v_thread uuid;
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
  -- Hidden live status cuts both ways: you can't reach out while hidden, nor reach someone hidden.
  if not coalesce((select p.show_live_status from profiles p where p.id = v_me), true) then
    raise exception 'Turn on your live status to message friends.';
  end if;
  if not coalesce((select p.show_live_status and not coalesce(p.is_disabled, false)
                     from profiles p where p.id = p_to_user), false) then
    raise exception 'They just finished their session.';
  end if;

  v_mine := lockin_reachable_session(v_me);
  v_theirs := lockin_reachable_session(p_to_user);
  v_thread := lockin_open_thread(v_me, p_to_user);

  if v_thread is null then
    if v_theirs is null then
      raise exception 'They just finished their session.';
    end if;
    -- A row still marked open that lockin_thread_is_open rejects (its closing trigger never fired —
    -- a session deleted outright) would hold the unique slot forever. Close it first.
    update lockin_threads t
       set closed_at = now()
     where t.user_a = least(v_me, p_to_user) and t.user_b = greatest(v_me, p_to_user)
       and t.closed_at is null
       and not lockin_thread_is_open(t.id);
    insert into lockin_threads (user_a, user_b)
    values (least(v_me, p_to_user), greatest(v_me, p_to_user))
    -- A simultaneous first message from the other side wins the race; use its thread.
    on conflict (user_a, user_b) where closed_at is null do nothing
    returning id into v_thread;
    if v_thread is null then
      v_thread := lockin_open_thread(v_me, p_to_user);
    end if;
    if v_thread is null then
      raise exception 'They just finished their session.';
    end if;
  end if;

  -- A light thread, not a firehose: 60 lines a thread, one every two seconds.
  if (select count(*) from lockin_messages m where m.thread_id = v_thread and m.from_user = v_me) >= 60 then
    raise exception 'That''s a lot of messages — back to the grind.';
  end if;
  if exists (select 1 from lockin_messages m
              where m.from_user = v_me and m.created_at > now() - interval '2 seconds') then
    raise exception 'Slow down a second.';
  end if;

  v_first_unread := not exists (
    select 1 from lockin_messages m
     where m.thread_id = v_thread and m.from_user = v_me and m.read_at is null);
  v_replying := exists (
    select 1 from lockin_messages m
     where m.thread_id = v_thread and m.from_user = p_to_user);

  insert into lockin_messages (thread_id, from_user, to_user, from_session_id, to_session_id, body)
  values (v_thread, v_me, p_to_user, v_mine, v_theirs, v_body)
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
      'Open Philoi to read it.',
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

-- Report the thread with a friend. Snapshots it server-side, since the rows stop being readable
-- (and are later deleted) once the thread closes.
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
  delete from lockin_threads where closed_at < now() - interval '2 days';
  delete from lockin_cheers where created_at < now() - interval '30 days';
$$;

revoke all on function public.expire_lockin_cheers() from public, anon, authenticated;

select cron.unschedule('philoi-lockin-cheers-expire')
 where exists (select 1 from cron.job where jobname = 'philoi-lockin-cheers-expire');
select cron.schedule('philoi-lockin-cheers-expire', '23 4 * * *',
                     $cron$select expire_lockin_cheers();$cron$);

commit;
