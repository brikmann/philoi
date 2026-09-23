-- 0206 — Two friends can talk without a campfire.
--
-- ─────────────────────────────── WHY ───────────────────────────────
--
-- Every message in this app is group-scoped. `messages.group_id` is NOT NULL, useChat takes a
-- groupId, and the only RLS that admits a reader is `is_group_member(group_id)`. So the one thing
-- two friends cannot do is say something to each other: the leaderboard hands you a profile, the
-- profile offers Add friend and Challenge, and then the path ends. MESSAGING_DM_SPEC.md has sat as
-- a stub since.
--
-- ── Why a second table rather than a nullable messages.group_id ──
--
-- Making group_id nullable would be the smaller diff and the worse change. `messages` carries a
-- rate-limit trigger, an attachment CHECK, a reactions junction, moderation reporting and the
-- campfire realtime subscription — every one of which reads group_id and would need an "…or it's
-- a DM" branch. More to the point its SELECT policy is
-- `is_group_member(group_id) and not is_blocked_either_way(user_id)`, and a null group_id makes
-- is_group_member null, which reads as DENY — so every already-installed build would go on
-- evaluating that policy against rows it can never see while the real rule lived somewhere else.
-- Two tables keep one rule per table.
--
-- ── The pair is the identity ──
--
-- A thread is the unordered pair {a, b}, stored ordered (user_a < user_b) so it has exactly one
-- row and a plain unique index can say so. Same shape friend_requests_pair_idx already uses for
-- the same reason. Threads are opened by RPC, never by client INSERT, so the ordering invariant
-- has one enforcer.
--
-- ── Blocking ──
--
-- Reuses is_blocked_either_way() rather than restating the rule. It is SECURITY DEFINER for the
-- reason its own comment gives — blocked_users' RLS hides the "they blocked me" direction from an
-- invoker-rights query — and it is mutual, so a block removes the thread from BOTH sides' view and
-- stops both directions of send. Realtime is covered by the same policy: postgres_changes
-- re-evaluates SELECT per subscriber, so a blocked sender's INSERT never reaches the other side's
-- live feed either.
--
-- ── Friends only ──
--
-- Per MESSAGING_DM_SPEC.md's guardrail. Enforced in the send/open RPCs, not in RLS: an accepted
-- friendship can be revoked, and unfriending someone should not delete the history you already
-- have with them. Read stays open to the two members; WRITE requires a live friendship.

-- ─────────────────────────── 0 · preconditions ───────────────────────────
do $guard$
begin
  if to_regprocedure('public.is_blocked_either_way(uuid)') is null then
    raise exception '0206 needs is_blocked_either_way(uuid) — see schema.sql';
  end if;
  if to_regprocedure('public.notify_event(uuid[],text,text,text,uuid,uuid,text,jsonb,text,text,jsonb)') is null then
    raise exception '0206 needs notify_event/11 — see 0120';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'friend_requests') then
    raise exception '0206 needs friend_requests — see 0031';
  end if;
end;
$guard$;

-- ─────────────────────────── 1 · the thread ───────────────────────────

create table if not exists dm_threads (
  id uuid primary key default gen_random_uuid(),
  -- ORDERED. user_a is always the smaller uuid; the CHECK is what makes the unique index below a
  -- real one-row-per-pair guarantee rather than a convention the next caller can forget.
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Bumped by dm_send. Drives the thread list's ordering, so a thread with no messages yet sorts
  -- by when it was opened rather than falling to the bottom as a null.
  last_message_at timestamptz not null default now(),
  -- Read state, one column per side. Not a join table: a thread has exactly two members forever,
  -- so a row per (thread, member) would be two rows that can only ever be two rows.
  a_last_read_at timestamptz not null default now(),
  b_last_read_at timestamptz not null default now(),
  constraint dm_threads_ordered_pair check (user_a < user_b)
);

create unique index if not exists dm_threads_pair_idx on dm_threads (user_a, user_b);
create index if not exists dm_threads_a_idx on dm_threads (user_a, last_message_at desc);
create index if not exists dm_threads_b_idx on dm_threads (user_b, last_message_at desc);

alter table dm_threads enable row level security;

-- ─────────────────────────── 2 · the messages ───────────────────────────

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references dm_threads(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text,
  -- What this row IS, so the renderer can tell a sentence from a card. Only 'text' is written by
  -- any code today — the other three are MESSAGING_DM_SPEC.md's inline challenge/invite/cheer
  -- sends, and the column exists now so adding one later is a client change rather than a
  -- migration against a live table.
  --
  -- The client SKIPS a kind it does not recognise, exactly as messages.system_event's renderer
  -- does. That rule is not decoration: OTA is closed while runtimeVersion is sdkVersion, so a
  -- build that meets a kind it has never heard of must fall silent rather than crash — and the
  -- only way that holds is if nothing starts writing a new kind until the reader has shipped.
  kind text not null default 'text' check (kind in ('text', 'challenge', 'invite', 'cheer')),
  -- The challenge/session a non-text kind points at. Null for 'text'.
  ref_id uuid,
  created_at timestamptz not null default now(),
  -- Soft delete, same as messages: a deleted message leaves the thread's shape intact.
  deleted_at timestamptz,
  -- A 'text' row must actually say something. Enforced here rather than only in the RPC so a
  -- future direct insert cannot post an empty bubble.
  constraint dm_messages_text_has_body check (kind <> 'text' or coalesce(btrim(body), '') <> '')
);

create index if not exists dm_messages_thread_idx on dm_messages (thread_id, created_at);
create index if not exists dm_messages_sender_idx on dm_messages (sender_id, created_at desc);

alter table dm_messages enable row level security;

-- ─────────────────────────── 3 · membership, as one function ───────────────────────────
--
-- SECURITY DEFINER for the same reason is_group_member is: dm_messages' policy has to ask a
-- question about dm_threads, and an invoker-rights read there would expand dm_threads' own RLS
-- inside every dm_messages row check.
create or replace function is_dm_member(p_thread_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from dm_threads t
    where t.id = p_thread_id
      and auth.uid() in (t.user_a, t.user_b)
  );
$$;

-- The OTHER member of a thread, from the caller's side. Null when the caller is not a member —
-- which is itself the "not yours" answer, so callers test for null rather than re-checking
-- membership separately.
create or replace function dm_other_member(p_thread_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case when t.user_a = auth.uid() then t.user_b
              when t.user_b = auth.uid() then t.user_a end
  from dm_threads t
  where t.id = p_thread_id;
$$;

-- ─────────────────────────── 4 · RLS ───────────────────────────
--
-- Read is for the two members, minus blocking. No INSERT/UPDATE/DELETE policy on either table at
-- all: with RLS on and no policy for a command, that command is denied for every non-owner role,
-- which is exactly the intent — every write goes through the definer RPCs in §5, so the friendship
-- gate, the ordered pair and the rate limit have exactly one enforcer each.

drop policy if exists "dm_threads: read if member" on dm_threads;
create policy "dm_threads: read if member" on dm_threads for select using (
  auth.uid() in (user_a, user_b)
  and not is_blocked_either_way(case when user_a = auth.uid() then user_b else user_a end)
);

drop policy if exists "dm_messages: read if member" on dm_messages;
create policy "dm_messages: read if member" on dm_messages for select using (
  is_dm_member(thread_id) and not is_blocked_either_way(sender_id)
);

revoke all on dm_threads from public, anon;
revoke all on dm_messages from public, anon;
grant select on dm_threads to authenticated;
grant select on dm_messages to authenticated;

-- ─────────────────────────── 5 · the write path ───────────────────────────

-- Open (or find) the thread with one friend, and return its id.
--
-- Idempotent: the second call returns the first call's row. That matters because the client calls
-- this on every mount of /dm/[friendId] — the thread id is what the realtime subscription filters
-- on, so it has to exist before the screen can listen.
create or replace function dm_open_thread(p_friend_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_friend_id is null or p_friend_id = v_me then
    raise exception 'Pick someone to message.';
  end if;
  if is_blocked_either_way(p_friend_id) then
    raise exception 'You can''t message this person.';
  end if;
  if not exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = v_me and fr.recipient_id = p_friend_id)
        or (fr.requester_id = p_friend_id and fr.recipient_id = v_me))
  ) then
    raise exception 'You can only message friends.';
  end if;

  v_a := least(v_me, p_friend_id);
  v_b := greatest(v_me, p_friend_id);

  -- on conflict DO UPDATE rather than DO NOTHING: `do nothing` returns no row, so RETURNING comes
  -- back empty on every call after the first and the caller would have to SELECT again. Setting
  -- user_a to itself is a no-op write that makes RETURNING fire either way.
  insert into dm_threads (user_a, user_b)
  values (v_a, v_b)
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into v_id;

  return v_id;
end;
$$;

-- Send one message, and tell the other side.
--
-- Its own RPC rather than an INSERT policy, for the reasons pingCampfireMember's client comment
-- sets out: notify_event is not granted to `authenticated` (0189 closed that whole path), and the
-- friendship gate plus the rate limit have to live somewhere a patched client cannot skip.
--
-- Returns the inserted row's id so the composer can reconcile its own optimistic bubble rather
-- than waiting for the realtime echo of its own send.
create or replace function dm_send(p_thread_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_other uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_sender text;
  v_id uuid;
  v_recent int;
  v_pending int;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  v_other := dm_other_member(p_thread_id);
  if v_other is null then raise exception 'That conversation is not yours.'; end if;

  if v_body = '' then raise exception 'Nothing to send.'; end if;
  -- Same ceiling as the composer's maxLength. Server-side because the client is the one place that
  -- cannot be the enforcer of what lands on someone else's screen.
  if length(v_body) > 2000 then v_body := left(v_body, 2000); end if;

  if is_blocked_either_way(v_other) then
    raise exception 'You can''t message this person.';
  end if;
  if not exists (
    select 1 from friend_requests fr
    where fr.status = 'accepted'
      and ((fr.requester_id = v_me and fr.recipient_id = v_other)
        or (fr.requester_id = v_other and fr.recipient_id = v_me))
  ) then
    raise exception 'You can only message friends.';
  end if;

  if exists (select 1 from profiles p where p.id = v_me and p.is_disabled) then
    raise exception 'Your account is disabled.';
  end if;

  -- Anti-flood, mirroring messages' enforce_message_rate_limit: 10 per 10s per sender across all
  -- their threads. Generous for a fast typer, a ceiling on a script.
  select count(*) into v_recent
  from dm_messages m
  where m.sender_id = v_me and m.created_at > now() - interval '10 seconds';
  if v_recent >= 10 then
    raise exception 'Slow down a moment.';
  end if;

  insert into dm_messages (thread_id, sender_id, body, kind)
  values (p_thread_id, v_me, v_body, 'text')
  returning id into v_id;

  update dm_threads t
     set last_message_at = now(),
         -- Sending is reading: your own message must not leave you with an unread badge on the
         -- thread you are looking at.
         a_last_read_at = case when t.user_a = v_me then now() else t.a_last_read_at end,
         b_last_read_at = case when t.user_b = v_me then now() else t.b_last_read_at end
   where t.id = p_thread_id;

  -- ONE BADGE UNTIL THEY LOOK.
  --
  -- notify_event writes the bell row and fires the push together, so "bell every message, push
  -- once" is not available. The rule is per THREAD instead: notify only when the recipient has no
  -- unread dm_received bell row for this thread already waiting. A back-and-forth of thirty
  -- messages is one banner, and the next one arrives only after they have opened the thread.
  --
  -- The unread test reads off notification_events, the same table 0152's ping rate limit reads —
  -- no new state, and it is already the record of what this person has been told.
  select count(*) into v_pending
  from notification_events ne
  where ne.user_id = v_other
    and ne.type = 'dm_received'
    and ne.target_id = p_thread_id
    and ne.created_at > coalesce(
      (select case when t.user_a = v_other then t.a_last_read_at else t.b_last_read_at end
         from dm_threads t where t.id = p_thread_id),
      '-infinity'::timestamptz
    );

  if v_pending = 0 then
    select display_name into v_sender from profiles where id = v_me;
    perform notify_event(
      array[v_other],
      'dm_received',
      coalesce(v_sender, 'A friend'),
      -- The message itself is the body. It is a 1:1 from someone they accepted as a friend, which
      -- is the trust level campfire_message's preview already assumes.
      left(v_body, 140),
      v_me, p_thread_id,
      '/dm/[friendId]', jsonb_build_object('friendId', v_me::text),
      null, 'circle',
      jsonb_build_object('thread_id', p_thread_id)
    );
  end if;

  return v_id;
end;
$$;

-- Mark my side of a thread read, up to now. Idempotent; a no-op for a thread that isn't mine.
create or replace function dm_mark_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  update dm_threads t
     set a_last_read_at = case when t.user_a = v_me then now() else t.a_last_read_at end,
         b_last_read_at = case when t.user_b = v_me then now() else t.b_last_read_at end
   where t.id = p_thread_id and v_me in (t.user_a, t.user_b);
end;
$$;

-- Delete one of my own messages. Soft, so the thread keeps its shape — same as delete_my_message.
create or replace function dm_delete_my_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  update dm_messages m
     set deleted_at = now()
   where m.id = p_message_id and m.sender_id = auth.uid() and m.deleted_at is null;
end;
$$;

-- ─────────────────────────── 6 · the thread list ───────────────────────────
--
-- ⚠️ The RETURNS TABLE output names are deliberately prefixed. A RETURNS TABLE output name shadows
-- a same-named table column inside the body, and the shadowed reference silently resolves to the
-- (null) output variable — so a bare `user_a` here would make `where auth.uid() in (t.user_a, …)`
-- match nothing and the inbox would come back empty with no error at all.
create or replace function get_my_dm_threads()
returns table (
  out_thread_id uuid,
  out_friend_id uuid,
  out_display_name text,
  out_avatar_url text,
  out_handle text,
  out_last_message_at timestamptz,
  out_last_body text,
  out_last_sender_id uuid,
  out_unread int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id,
    other.id,
    other.display_name,
    other.avatar_url,
    other.handle,
    t.last_message_at,
    last_msg.body,
    last_msg.sender_id,
    coalesce(unread.n, 0)::int
  from dm_threads t
  cross join lateral (
    select p.id, p.display_name, p.avatar_url, p.handle from profiles p
    where p.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
  ) other
  cross join lateral (
    select case when t.user_a = auth.uid() then t.a_last_read_at else t.b_last_read_at end as at
  ) mine
  left join lateral (
    select m.body, m.sender_id
    from dm_messages m
    where m.thread_id = t.id and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) last_msg on true
  left join lateral (
    select count(*) as n
    from dm_messages m
    where m.thread_id = t.id
      and m.deleted_at is null
      and m.sender_id <> auth.uid()
      and m.created_at > mine.at
  ) unread on true
  where auth.uid() in (t.user_a, t.user_b)
    and not is_blocked_either_way(other.id)
    -- A thread nobody has spoken in yet is an artefact of tapping Message and backing out. It
    -- belongs in neither inbox until somebody says something.
    and last_msg.body is not null
  order by t.last_message_at desc;
$$;

-- ─────────────────────────── 7 · grants ───────────────────────────
--
-- Each revoke names anon EXPLICITLY. `revoke ... from public, authenticated` leaves anon's own
-- grant standing — that is how credit_pass_xp and the season grant functions ended up
-- anon-callable in prod.
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.is_dm_member(uuid)',
    'public.dm_other_member(uuid)',
    'public.dm_open_thread(uuid)',
    'public.dm_send(uuid, text)',
    'public.dm_mark_read(uuid)',
    'public.dm_delete_my_message(uuid)',
    'public.get_my_dm_threads()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  -- 🔴 is_dm_member IS CLIENT-CALLABLE, and it has to be.
  --
  -- It looks like an internal helper and it was written as one. But an RLS policy expression is
  -- evaluated AS THE QUERYING ROLE, not as the table owner — so "dm_messages: read if member",
  -- which calls is_dm_member, needs `authenticated` to hold EXECUTE on it. Revoked, every read of
  -- a DM by a real client dies with `42501: permission denied for function is_dm_member` and the
  -- thread screen is blank for everybody. The first dry-run of this file did exactly that, at the
  -- one assertion that reads as `authenticated` rather than as postgres.
  --
  -- Granting it leaks nothing: it answers only "am *I* in this thread", never who else is. This is
  -- the same reason is_group_member and is_blocked_either_way are open to clients.
  --
  -- dm_other_member stays CLOSED, and the difference is the point: no policy names it. It is
  -- called only from dm_send, which is SECURITY DEFINER and therefore runs as its owner.
  foreach f in array array[
    'public.is_dm_member(uuid)',
    'public.dm_open_thread(uuid)',
    'public.dm_send(uuid, text)',
    'public.dm_mark_read(uuid)',
    'public.dm_delete_my_message(uuid)',
    'public.get_my_dm_threads()'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$grants$;

-- ─────────────────────────── 8 · realtime ───────────────────────────
--
-- postgres_changes re-evaluates the table's SELECT policy per subscriber, so §4's read rule is
-- what keeps a blocked sender's INSERT out of the other side's live feed too — there is no second
-- filter to keep in step. Guarded the way 0171/0173 guard theirs: the publication does not exist
-- on a bare local database.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_messages')
  then
    alter publication supabase_realtime add table dm_messages;
  end if;
end;
$realtime$;


-- ─────────────────────────── 9 · verification ───────────────────────────
--
-- Two blocks. The first asks questions of the catalog and answers them with no writes. The second
-- drives the real write path as a real caller — and THROWS ITSELF AWAY at the end.
--
-- That unwind is not tidiness. This migration runs against prod, where `profiles` are pilot users:
-- a probe that commits leaves a message reading "probe" in a real person's thread and a bell row
-- telling them they have mail. 0161's pattern — do the work in a sub-block, `raise exception 'ok'`
-- to roll the sub-transaction back, swallow exactly that one message — is what makes an
-- end-to-end probe safe to run here at all.
--
-- Every "expect 0" is paired with a positive control, because a check that would also be green
-- under the bug is not a check.

do $verify_static$
declare
  v_cat text;
begin
  -- 1 · dm_received files under friends_social WITHOUT this migration touching the registry.
  --     notification_category's else-branch is friends_social, which is where the spec puts it, so
  --     there is nothing to restate — and restating it is precisely how 0135 filed every session
  --     recap under the wrong toggle (see 0164's own warning). Asserted, not assumed: if someone
  --     later adds a branch that files DMs elsewhere, this is the line that says so.
  v_cat := notification_category('dm_received');
  if v_cat is distinct from 'friends_social' then
    raise exception '0206: dm_received files under %, expected friends_social', v_cat;
  end if;
  -- Positive control — a notification_category that answered friends_social for EVERYTHING would
  -- pass the check above vacuously.
  if notification_category('challenge_won') is distinct from 'challenges' then
    raise exception '0206: notification_category is not discriminating; the check above proves nothing';
  end if;

  -- 2 · dm_received pushes by default (it is not in notification_push_default's opt-out list).
  if not notification_push_default('dm_received') then
    raise exception '0206: dm_received would not push; the spec asks for bell + push';
  end if;
  if notification_push_default('campfire_message') then
    raise exception '0206: notification_push_default is not discriminating; the check above proves nothing';
  end if;

  -- 3 · the internal helpers are closed to clients and the five RPCs are open to exactly one role.
  if has_function_privilege('anon', 'public.dm_send(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.dm_open_thread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_my_dm_threads()', 'execute') then
    raise exception '0206: anon can execute a DM RPC';
  end if;
  if has_function_privilege('authenticated', 'public.dm_other_member(uuid)', 'execute') then
    raise exception '0206: dm_other_member is callable by authenticated; it is internal to dm_send';
  end if;
  -- ...and its opposite. is_dm_member MUST be executable by authenticated, because the
  -- "dm_messages: read if member" policy calls it and a policy runs as the querying role. This
  -- assertion is the one that would catch a future tidy-up "closing the internal helpers".
  if not has_function_privilege('authenticated', 'public.is_dm_member(uuid)', 'execute') then
    raise exception '0206: authenticated cannot execute is_dm_member; every DM read would 42501';
  end if;
  -- Positive control for the two revokes above — a revoke that also took the client grant would
  -- pass them while breaking every send.
  if not has_function_privilege('authenticated', 'public.dm_send(uuid,text)', 'execute') then
    raise exception '0206: authenticated cannot execute dm_send; nobody can send a DM';
  end if;

  -- 4 · one signature each. A second overload of dm_send would make the next caller ambiguous.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('dm_send', 'dm_open_thread', 'dm_mark_read', 'dm_delete_my_message',
                        'get_my_dm_threads', 'is_dm_member', 'dm_other_member')
    group by p.proname having count(*) > 1
  ) then
    raise exception '0206: a DM function has more than one overload';
  end if;

  raise notice '0206 static checks ok — category, push default, grants, overloads';
end
$verify_static$;

do $verify_live$
declare
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_thread uuid;
  v_n int;
  v_denied boolean;
begin
  -- The probe needs a REAL accepted friendship, because friends-only is the gate under test.
  -- Picking "the two oldest profiles" and hoping would make every assertion below skippable, which
  -- is the same thing as not having them.
  select fr.requester_id, fr.recipient_id into v_a, v_b
  from friend_requests fr
  where fr.status = 'accepted'
    and not exists (select 1 from blocked_users b
                    where (b.blocker_id = fr.requester_id and b.blocked_id = fr.recipient_id)
                       or (b.blocker_id = fr.recipient_id and b.blocked_id = fr.requester_id))
  order by fr.created_at
  limit 1;

  if v_a is null then
    raise notice '0206: no accepted friendship on this database — the live probe was not exercised.';
    return;
  end if;

  begin
    -- Nothing in here buzzes a real phone. Transaction-scoped, and this sub-block unwinds anyway.
    perform set_config('philoi.suppress_push', 'on', true);

    -- 5 · the ordered-pair CHECK actually rejects the wrong order. Without it the unique index
    --     guarantees nothing, because {a,b} and {b,a} would be two distinct rows.
    v_denied := false;
    begin
      insert into dm_threads (user_a, user_b) values (greatest(v_a, v_b), least(v_a, v_b));
    exception when check_violation then v_denied := true;
    end;
    if not v_denied then
      raise exception '0206: dm_threads accepted an out-of-order pair; the unique index is not a pair guarantee';
    end if;

    -- 6 · the write path end to end, AS A REAL CALLER. The RPCs read auth.uid(), so the probe
    --     supplies one; calling them as bare postgres would exercise a path no client takes and
    --     every auth.uid() branch would silently take its null arm.
    perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

    v_thread := dm_open_thread(v_b);
    if v_thread is null then
      raise exception '0206: dm_open_thread returned null for an accepted friend';
    end if;
    -- Idempotent: a second tap must not open a second thread.
    if dm_open_thread(v_b) is distinct from v_thread then
      raise exception '0206: dm_open_thread is not idempotent — a second tap opens a second thread';
    end if;

    -- ⚠️ THE PROBE CLOCK IS TRANSACTION START. now() does not advance inside a transaction, so
    -- every row this block writes — the thread's default read marks, each dm_messages row, each
    -- bell row — carries the SAME timestamp. The "one badge until they look" rule in §5 compares a
    -- bell row's created_at against the recipient's last_read_at, and under a frozen clock that
    -- comparison is `now() > now()`, which is false forever: the rule can never engage and §7
    -- below fails against correct code. It did, on the first dry-run of this file.
    --
    -- So the probe supplies the elapsed time the transaction cannot: back-date the read marks to
    -- an hour ago, which is what "this thread was opened earlier and nobody has looked since"
    -- actually means. Everything after this line is then testing the rule rather than the clock.
    update dm_threads t
       set a_last_read_at = now() - interval '1 hour',
           b_last_read_at = now() - interval '1 hour'
     where t.id = v_thread;

    perform dm_send(v_thread, 'probe');
    select count(*) into v_n from dm_messages m where m.thread_id = v_thread;
    if v_n <> 1 then
      raise exception '0206: dm_send wrote % rows, expected 1', v_n;
    end if;

    -- 7 · the recipient was told, exactly once, and the second message does NOT tell them again
    --     while the first is still unread. This is the "one badge until they look" rule, and it is
    --     the difference between a DM and a pager.
    select count(*) into v_n from notification_events ne
     where ne.user_id = v_b and ne.type = 'dm_received' and ne.target_id = v_thread;
    if v_n <> 1 then
      raise exception '0206: a DM wrote % bell rows, expected 1', v_n;
    end if;
    perform dm_send(v_thread, 'probe two');
    select count(*) into v_n from notification_events ne
     where ne.user_id = v_b and ne.type = 'dm_received' and ne.target_id = v_thread;
    if v_n <> 1 then
      raise exception '0206: a second unread DM rang the bell again (% rows); one badge until they look', v_n;
    end if;

    -- 8 · unread. Sending is reading, so the SENDER sees none...
    select d.out_unread into v_n from get_my_dm_threads() d where d.out_thread_id = v_thread;
    if coalesce(v_n, -1) <> 0 then
      raise exception '0206: the sender has % unread on their own messages', v_n;
    end if;
    -- ...and the RECIPIENT sees both. This is the positive control for the line above: a
    -- get_my_dm_threads() that returned 0 for everybody would pass it vacuously.
    perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
    select d.out_unread into v_n from get_my_dm_threads() d where d.out_thread_id = v_thread;
    if coalesce(v_n, -1) <> 2 then
      raise exception '0206: the recipient has % unread, expected 2', v_n;
    end if;
    perform dm_mark_read(v_thread);
    select d.out_unread into v_n from get_my_dm_threads() d where d.out_thread_id = v_thread;
    if coalesce(v_n, -1) <> 0 then
      raise exception '0206: dm_mark_read left % unread', v_n;
    end if;
    -- Having looked, they can be told again.
    perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    perform dm_send(v_thread, 'probe three');
    select count(*) into v_n from notification_events ne
     where ne.user_id = v_b and ne.type = 'dm_received' and ne.target_id = v_thread;
    if v_n <> 2 then
      raise exception '0206: after reading, a new DM did not ring the bell (% rows, expected 2)', v_n;
    end if;

    -- 9 · a third party sees nothing. RLS is the whole privacy story for a DM, so this is the
    --     assertion that matters most — and it is checked as `authenticated`, the only role the
    --     policies actually apply to. As postgres every one of them is bypassed.
    select p.id into v_c from profiles p where p.id not in (v_a, v_b) order by p.created_at limit 1;
    if v_c is null then
      raise notice '0206: no third profile — the outsider probe was not exercised.';
    else
      perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);

      if is_dm_member(v_thread) then
        raise exception '0206: a non-member passes is_dm_member';
      end if;
      if dm_other_member(v_thread) is not null then
        raise exception '0206: dm_other_member answers for a non-member';
      end if;

      v_denied := false;
      begin
        perform dm_send(v_thread, 'outsider');
      exception when others then
        if sqlerrm like '%not yours%' then v_denied := true; else raise; end if;
      end;
      if not v_denied then
        raise exception '0206: an outsider sent into a thread they are not in';
      end if;

      -- The RLS read, under the role the policy is written for.
      perform set_config('role', 'authenticated', true);
      select count(*) into v_n from dm_messages m where m.thread_id = v_thread;
      if v_n <> 0 then
        raise exception '0206: an outsider can read % messages of someone else''s thread', v_n;
      end if;
      select count(*) into v_n from dm_threads t where t.id = v_thread;
      if v_n <> 0 then
        raise exception '0206: an outsider can see someone else''s thread row';
      end if;

      -- Positive control for both zeroes above: the same policies, same role, MEMBER uid. Without
      -- this, an RLS bug that hid the thread from its own members would read as a clean pass.
      perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
      select count(*) into v_n from dm_messages m where m.thread_id = v_thread;
      if v_n <> 3 then
        raise exception '0206: a MEMBER reads % of their own 3 messages — the policy is too tight', v_n;
      end if;
    end if;

    -- Throw the whole probe away: the sub-transaction unwinds the threads, the messages, the bell
    -- rows and every set_config above with it. Nothing below this line is left on prod.
    raise exception 'ok';
  exception when others then
    if sqlerrm <> 'ok' then raise; end if;
  end;

  -- Proof the unwind took. Without this the block above could have committed and the migration
  -- would still report success.
  if exists (select 1 from dm_messages) then
    raise exception '0206: the probe did not unwind — dm_messages is not empty';
  end if;
  if exists (select 1 from dm_threads) then
    raise exception '0206: the probe did not unwind — dm_threads is not empty';
  end if;

  raise notice '0206: dm_threads + dm_messages live — friends-only, block-aware, one badge per thread; probe unwound clean';
end
$verify_live$;
