-- Campfire privacy tiers (open/gated/private) + a discovery preview RPC (PHILOI_UI_SPEC.md §10).
-- Existing public circles all default to 'open' (fully backward compatible — nothing that was
-- instantly-joinable becomes gated by this migration). Private stays exactly as today:
-- is_public = false, reachable only via join_group_with_code.
alter table groups add column if not exists visibility text not null default 'open'
  check (visibility in ('open', 'gated'));

-- A user's pending ask to join a gated campfire — the owner approves/denies (an approval inbox
-- UI is a follow-up; this migration only wires the request + owner notification).
create table if not exists group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now()
);

create unique index if not exists group_join_requests_pending_unique
  on group_join_requests (group_id, user_id) where status = 'pending';

alter table group_join_requests enable row level security;

drop policy if exists "group_join_requests: read own or as owner" on group_join_requests;
create policy "group_join_requests: read own or as owner" on group_join_requests for select using (
  user_id = auth.uid() or exists (select 1 from groups where id = group_id and owner_id = auth.uid())
);

-- No insert/update policy for regular users — RPC-gated below, same pattern as
-- join_public_group/join_group_with_code.

create or replace function request_to_join_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_requester_name text;
begin
  select * into v_group from groups where id = p_group_id and is_public = true and visibility = 'gated';
  if v_group.id is null then
    raise exception 'That campfire is not open to join requests.';
  end if;

  if is_group_member(p_group_id) then
    raise exception 'Already a member.';
  end if;

  insert into group_join_requests (group_id, user_id)
  values (p_group_id, auth.uid())
  on conflict (group_id, user_id) where status = 'pending' do nothing;

  select display_name into v_requester_name from profiles where id = auth.uid();
  perform notify_push(
    array[v_group.owner_id],
    v_group.name,
    coalesce(v_requester_name, 'Someone') || ' wants to join your campfire',
    jsonb_build_object('type', 'join_request', 'group_id', p_group_id)
  );
end;
$$;

-- Signature changed (visibility param) — drop first, same rule every changed signature gets
-- in this file.
drop function if exists create_group_with_owner(text, text, text, text, boolean, text, text);
create function create_group_with_owner(
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_is_public boolean default false,
  p_course_code text default null,
  p_school text default null,
  p_visibility text default 'open'
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  if p_visibility not in ('open', 'gated') then
    raise exception 'Invalid campfire visibility.';
  end if;

  insert into groups (name, emoji, owner_id, goal_type, cadence, is_public, course_code, school, visibility)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence, coalesce(p_is_public, false), p_course_code, p_school, p_visibility)
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  insert into invites (code, inviter_id, group_id)
  values (v_group.join_code, auth.uid(), v_group.id);

  return v_group;
end;
$$;

-- Only 'open' circles are instant-join now — 'gated' ones must go through
-- request_to_join_group instead.
create or replace function join_public_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where id = p_group_id and is_public = true and visibility = 'open';

  if v_group.id is null then
    raise exception 'That circle is not open for instant joining.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- Return shape changed (visibility/campfire_level/has_pending_request added, for the valley's
-- privacy-aware preview sheet) — drop first.
drop function if exists get_discoverable_groups(text, int, text);
create function get_discoverable_groups(p_goal_type text default null, p_limit int default 20, p_search text default null)
returns table (
  id uuid,
  name text,
  emoji text,
  goal_type text,
  cadence text,
  member_count bigint,
  owner_university text,
  course_code text,
  school text,
  visibility text,
  campfire_level int,
  has_pending_request boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.id,
    g.name,
    g.emoji,
    g.goal_type,
    g.cadence,
    (select count(*) from group_members gm2 where gm2.group_id = g.id) as member_count,
    owner.university as owner_university,
    g.course_code,
    g.school,
    g.visibility,
    campfire_level_for_xp(coalesce((select cl.xp from campfire_levels cl where cl.group_id = g.id), 0)) as campfire_level,
    exists (
      select 1 from group_join_requests r
      where r.group_id = g.id and r.user_id = auth.uid() and r.status = 'pending'
    ) as has_pending_request
  from groups g
  join profiles owner on owner.id = g.owner_id
  where g.is_public = true
    and not exists (
      select 1 from group_members gm
      where gm.group_id = g.id and gm.user_id = auth.uid()
    )
    and (p_goal_type is null or g.goal_type = p_goal_type)
    and (
      p_search is null
      or g.name ilike '%' || p_search || '%'
      or g.course_code ilike '%' || p_search || '%'
    )
  order by
    (owner.university is not null and owner.university = (select p.university from profiles p where p.id = auth.uid())) desc,
    g.created_at desc
  limit p_limit;
$$;

-- Discovery preview sheet (PHILOI_UI_SPEC.md §10: "tap a fire -> preview sheet, never an
-- instant join"). Unlike get_campfire_level(), this must also work for NON-members previewing
-- an open/gated campfire before joining, so it's gated on is_public rather than membership
-- (falling back to membership so a caller can still preview their own private "My fires"
-- circles from the valley).
create or replace function get_campfire_preview(p_group_id uuid)
returns table (
  group_id uuid,
  name text,
  emoji text,
  visibility text,
  is_public boolean,
  is_member boolean,
  member_count bigint,
  active_lock_in_count bigint,
  campfire_level int,
  member_names text[],
  recent_photo_urls text[],
  has_pending_request boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_group groups;
  v_is_member boolean;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'Campfire not found.';
  end if;

  v_is_member := is_group_member(p_group_id);
  if not v_is_member and not v_group.is_public then
    raise exception 'That campfire is private.';
  end if;

  return query
  select
    v_group.id,
    v_group.name,
    v_group.emoji,
    v_group.visibility,
    v_group.is_public,
    v_is_member,
    (select count(*) from group_members gm where gm.group_id = v_group.id),
    (select count(*) from lock_in_sessions ls where ls.circle_id = v_group.id and ls.status = 'active'),
    campfire_level_for_xp(coalesce((select cl.xp from campfire_levels cl where cl.group_id = v_group.id), 0)),
    (select coalesce(array_agg(p.display_name), '{}') from (
      select gm.user_id from group_members gm where gm.group_id = v_group.id limit 6
    ) m join profiles p on p.id = m.user_id),
    (select coalesce(array_agg(ci.photo_url), '{}') from (
      select cic.check_in_id, cic.posted_at from check_in_circles cic where cic.circle_id = v_group.id
      order by cic.posted_at desc limit 4
    ) recent
    join check_ins ci on ci.id = recent.check_in_id
    join profiles poster on poster.id = ci.user_id
    where ci.photo_url is not null and (v_is_member or poster.photo_visibility = 'everyone')),
    exists (
      select 1 from group_join_requests r
      where r.group_id = v_group.id and r.user_id = auth.uid() and r.status = 'pending'
    );
end;
$$;
