-- The REAL friend graph (PHILOI_UI_SPEC.md §4b/§16, design-mocks/21/34/35) — replaces the
-- "friend = campfire co-member" placeholder from migration 0030_friends_and_nudge.sql. A friend
-- is now an explicit mutual add: send -> accept/decline, exactly like every mock shows. Campfire
-- membership and friendship are separate graphs from here on.
--
-- One row per pair, not two: a pending request and an accepted friendship are the SAME row,
-- just a different `status` — accepting flips status in place rather than inserting a second
-- row. The unique index below is built on the pair regardless of direction (least/greatest), so
-- it's impossible to end up with both a A->B and a B->A row for the same two people.
create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (requester_id <> recipient_id)
);

create unique index if not exists friend_requests_pair_idx on friend_requests (
  least(requester_id, recipient_id), greatest(requester_id, recipient_id)
);
create index if not exists friend_requests_recipient_idx on friend_requests (recipient_id, status);
create index if not exists friend_requests_requester_idx on friend_requests (requester_id, status);

alter table friend_requests enable row level security;

-- Read-only for either side of the pair; every write goes through the RPCs below (send/
-- respond/cancel), same "no insert/update policy — RPC-gated" pattern as daily_fire.
drop policy if exists "friend_requests: read own" on friend_requests;
create policy "friend_requests: read own" on friend_requests for select using (
  auth.uid() = requester_id or auth.uid() = recipient_id
);

-- Search by @handle or display name (design-mocks/35) — excludes yourself and demo/disabled
-- accounts, and reports each result's current relationship state so the client can render the
-- exact right button (Add / Requested / Accept / Friends) per PHILOI_UI_SPEC.md §4b's state
-- machine, without a second round-trip per row.
create or replace function search_people(p_query text, p_limit int default 20)
returns table (
  user_id uuid,
  display_name text,
  handle text,
  university text,
  avatar_url text,
  relationship text, -- 'none' | 'requested' | 'incoming' | 'friends'
  mutual_circle_name text -- one shared campfire, if any — the "Suggested from your campfires" hint
)
language sql
security definer
set search_path = public
stable
as $$
  with matches as (
    select p.id, p.display_name, p.handle, p.university, p.avatar_url
    from profiles p
    where p.id <> auth.uid()
      and not p.is_demo and not p.is_disabled
      and (p.handle ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%')
    order by
      -- exact/prefix handle matches first, then alphabetical — a search for "ma" shouldn't bury
      -- @mateod under every display name that merely contains "ma" somewhere in the middle.
      (p.handle = p_query) desc,
      (p.handle ilike p_query || '%') desc,
      p.display_name asc
    limit p_limit
  ),
  rel as (
    select fr.requester_id, fr.recipient_id, fr.status
    from friend_requests fr
    where fr.requester_id = auth.uid() or fr.recipient_id = auth.uid()
  )
  select
    m.id,
    m.display_name,
    m.handle,
    m.university,
    m.avatar_url,
    case
      when r.status = 'accepted' then 'friends'
      when r.status = 'pending' and r.requester_id = auth.uid() then 'requested'
      when r.status = 'pending' and r.recipient_id = auth.uid() then 'incoming'
      else 'none'
    end as relationship,
    (
      select g.name from group_members gm1
      join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = m.id
      join groups g on g.id = gm1.group_id
      where gm1.user_id = auth.uid()
      limit 1
    ) as mutual_circle_name
  from matches m
  left join rel r on (r.requester_id = auth.uid() and r.recipient_id = m.id)
                   or (r.recipient_id = auth.uid() and r.requester_id = m.id)
  order by m.display_name;
$$;

-- "Suggested · from your campfires" (design-mocks/35) — people who share a campfire with you and
-- aren't already friends/pending, for the add-friend screen's second section.
create or replace function suggested_people(p_limit int default 10)
returns table (
  user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  mutual_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select distinct on (p.id)
    p.id,
    p.display_name,
    p.handle,
    p.avatar_url,
    g.name
  from group_members gm1
  join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id <> auth.uid()
  join groups g on g.id = gm1.group_id
  join profiles p on p.id = gm2.user_id and not p.is_demo and not p.is_disabled
  where gm1.user_id = auth.uid()
    and not exists (
      select 1 from friend_requests fr
      where (fr.requester_id = auth.uid() and fr.recipient_id = p.id)
         or (fr.recipient_id = auth.uid() and fr.requester_id = p.id)
    )
  order by p.id
  limit p_limit;
$$;

create or replace function send_friend_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id = auth.uid() then
    raise exception 'You can''t friend yourself.';
  end if;
  if exists (
    select 1 from friend_requests
    where (requester_id = auth.uid() and recipient_id = p_user_id)
       or (requester_id = p_user_id and recipient_id = auth.uid())
  ) then
    raise exception 'A request already exists between you two.';
  end if;

  insert into friend_requests (requester_id, recipient_id, status)
  values (auth.uid(), p_user_id, 'pending');
end;
$$;

-- Accept or decline an INCOMING request (one someone else sent you). Declining deletes the row
-- outright — back to 'none', matching the state machine (no lingering "declined" state visible
-- anywhere in the mocks).
create or replace function respond_friend_request(p_user_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_accept then
    update friend_requests
    set status = 'accepted', responded_at = now()
    where requester_id = p_user_id and recipient_id = auth.uid() and status = 'pending';
  else
    delete from friend_requests
    where requester_id = p_user_id and recipient_id = auth.uid() and status = 'pending';
  end if;

  if not found then
    raise exception 'No pending request from that person.';
  end if;
end;
$$;

-- Cancel an OUTGOING request you sent (requested -> none).
create or replace function cancel_friend_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from friend_requests
  where requester_id = auth.uid() and recipient_id = p_user_id and status = 'pending';

  if not found then
    raise exception 'No pending request to that person.';
  end if;
end;
$$;

create or replace function get_pending_friend_requests()
returns table (
  request_user_id uuid,
  display_name text,
  handle text,
  avatar_url text,
  direction text, -- 'incoming' | 'sent'
  mutual_count int,
  mutual_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with my_friends as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as uid
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  ),
  pending as (
    select
      case when recipient_id = auth.uid() then requester_id else recipient_id end as uid,
      case when recipient_id = auth.uid() then 'incoming' else 'sent' end as direction,
      created_at
    from friend_requests
    where status = 'pending' and (requester_id = auth.uid() or recipient_id = auth.uid())
  )
  select
    pending.uid as request_user_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    pending.direction,
    -- Mutual friends = how many of THIS candidate's own accepted friends are also in mine.
    (
      select count(*)::int
      from friend_requests fr2
      join my_friends mf
        on mf.uid = case when fr2.requester_id = pending.uid then fr2.recipient_id else fr2.requester_id end
      where fr2.status = 'accepted' and (fr2.requester_id = pending.uid or fr2.recipient_id = pending.uid)
    ) as mutual_count,
    (
      select g.name from group_members gm1
      join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = pending.uid
      join groups g on g.id = gm1.group_id
      where gm1.user_id = auth.uid()
      limit 1
    ) as mutual_circle_name
  from pending
  join profiles p on p.id = pending.uid
  order by pending.created_at desc;
$$;

-- Replaces the co-membership version from migration 0030 — same output shape (so people.tsx's
-- consumers don't need to change), but sourced from real accepted friendships. shared_circle_id/
-- name are now nullable — two real friends may share no campfire at all (§16's H2H
-- reconciliation: friend-to-friend, no campfire required).
drop function if exists get_my_friends();
create or replace function get_my_friends()
returns table (
  friend_id uuid,
  display_name text,
  avatar_url text,
  tier text,
  division int,
  current_streak int,
  last_lockin_at timestamptz,
  shared_circle_id uuid,
  shared_circle_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with fr as (
    select case when requester_id = auth.uid() then recipient_id else requester_id end as uid
    from friend_requests
    where status = 'accepted' and (requester_id = auth.uid() or recipient_id = auth.uid())
  )
  select
    p.id as friend_id,
    p.display_name,
    p.avatar_url,
    r.tier,
    r.division,
    p.current_streak,
    (
      select max(ci.created_at)
      from check_ins ci
      where ci.user_id = p.id and ci.duration_seconds > 0 and ci.removed_at is null
    ) as last_lockin_at,
    shared.circle_id as shared_circle_id,
    shared.circle_name as shared_circle_name
  from fr
  join profiles p on p.id = fr.uid
  cross join lateral rank_tier_for_score(universal_score(p.id)) r
  left join lateral (
    select g.id as circle_id, g.name as circle_name
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id and gm2.user_id = p.id
    join groups g on g.id = gm1.group_id
    where gm1.user_id = auth.uid()
    limit 1
  ) shared on true
  order by p.display_name;
$$;

-- nudge_to_lock_in (migration 0030) gated on campfire co-membership — now gates on real
-- friendship instead, matching "the friend ping operates on friends, not campfire members".
create or replace function nudge_to_lock_in(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender text;
begin
  if p_user_id = auth.uid() then
    raise exception 'You can''t nudge yourself.';
  end if;
  if not exists (
    select 1 from friend_requests
    where status = 'accepted'
      and ((requester_id = auth.uid() and recipient_id = p_user_id)
        or (requester_id = p_user_id and recipient_id = auth.uid()))
  ) then
    raise exception 'You can only nudge friends.';
  end if;

  select display_name into v_sender from profiles where id = auth.uid();

  perform notify_push(
    array[p_user_id],
    'Lock in?',
    coalesce(v_sender, 'A friend') || ' pinged you to lock in 🔥',
    jsonb_build_object('type', 'lock_in_nudge', 'from_user_id', auth.uid()),
    'accountability'
  );
end;
$$;
