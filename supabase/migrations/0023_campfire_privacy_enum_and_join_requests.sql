-- Unifies is_public/visibility into a single `privacy` enum (PHILOI_UI_SPEC.md §14) and adds
-- the owner approve/deny join-request flow for gated campfires.

alter table groups add column if not exists privacy text not null default 'open'
  check (privacy in ('open', 'gated', 'private'));

do $$
begin
  if not exists (select 1 from _migrations where name = 'groups_privacy_backfill_v1') then
    update groups set privacy = case
      when not is_public then 'private'
      when visibility = 'gated' then 'gated'
      else 'open'
    end;
    insert into _migrations (name) values ('groups_privacy_backfill_v1');
  end if;
end $$;

drop policy if exists "groups: read if public" on groups;
create policy "groups: read if public" on groups for select using (privacy in ('open', 'gated'));

-- Signature changed (is_public/visibility collapsed into one p_privacy param) — drop first.
drop function if exists create_group_with_owner(text, text, text, text, boolean, text, text);
drop function if exists create_group_with_owner(text, text, text, text, boolean, text, text, text);
create function create_group_with_owner(
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_course_code text default null,
  p_school text default null,
  p_privacy text default 'open'
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  if p_privacy not in ('open', 'gated', 'private') then
    raise exception 'Invalid campfire privacy.';
  end if;

  insert into groups (name, emoji, owner_id, goal_type, cadence, course_code, school, privacy)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence, p_course_code, p_school, p_privacy)
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  insert into invites (code, inviter_id, group_id)
  values (v_group.join_code, auth.uid(), v_group.id);

  return v_group;
end;
$$;

create or replace function join_public_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where id = p_group_id and privacy = 'open';

  if v_group.id is null then
    raise exception 'That circle is not open for instant joining.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

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
  select * into v_group from groups where id = p_group_id and privacy = 'gated';
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

-- Return shape changed (visibility -> privacy) — drop first.
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
  privacy text,
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
    g.privacy,
    campfire_level_for_xp(coalesce((select cl.xp from campfire_levels cl where cl.group_id = g.id), 0)) as campfire_level,
    exists (
      select 1 from group_join_requests r
      where r.group_id = g.id and r.user_id = auth.uid() and r.status = 'pending'
    ) as has_pending_request
  from groups g
  join profiles owner on owner.id = g.owner_id
  where g.privacy in ('open', 'gated')
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

-- Return shape changed (is_public/visibility -> privacy) — drop first.
drop function if exists get_campfire_preview(uuid);
create function get_campfire_preview(p_group_id uuid)
returns table (
  group_id uuid,
  name text,
  emoji text,
  privacy text,
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
  if not v_is_member and v_group.privacy = 'private' then
    raise exception 'That campfire is private.';
  end if;

  return query
  select
    v_group.id,
    v_group.name,
    v_group.emoji,
    v_group.privacy,
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

-- Join-request approve/deny (PHILOI_UI_SPEC.md §14) — each checks ownership itself so it's
-- safe to call directly (no separate "internal" helper needed); approve_all/update_privacy's
-- auto-approve-on-open both just loop calling approve_join_request().
create or replace function approve_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req group_join_requests;
  v_owner_id uuid;
  v_group_name text;
begin
  select * into v_req from group_join_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    return; -- already handled or gone — approve_all's loop snapshot can race a single approve/deny
  end if;

  select owner_id, name into v_owner_id, v_group_name from groups where id = v_req.group_id;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve join requests.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_req.group_id, v_req.user_id, 'member')
  on conflict (group_id, user_id) do nothing;

  update group_join_requests set status = 'approved' where id = v_req.id;

  perform notify_push(
    array[v_req.user_id],
    v_group_name,
    'You''re in 🔥 ' || coalesce(v_group_name, 'the campfire'),
    jsonb_build_object('type', 'join_request_approved', 'group_id', v_req.group_id)
  );
end;
$$;

create or replace function deny_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_owner_id uuid;
begin
  select r.group_id, g.owner_id into v_group_id, v_owner_id
  from group_join_requests r join groups g on g.id = r.group_id
  where r.id = p_request_id and r.status = 'pending';

  if v_group_id is null then
    return;
  end if;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can deny join requests.';
  end if;

  update group_join_requests set status = 'denied' where id = p_request_id;
end;
$$;

create or replace function approve_all_join_requests(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_req_id uuid;
begin
  select owner_id into v_owner_id from groups where id = p_group_id;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can approve join requests.';
  end if;

  for v_req_id in select id from group_join_requests where group_id = p_group_id and status = 'pending' loop
    perform approve_join_request(v_req_id);
  end loop;
end;
$$;

-- Owner-only requests list for mock 22 — context line surfaces the requester's school + one
-- other circle they share with the viewing owner (a real, queryable signal); "mutual friends"
-- from the mock has no backing data (no friend-graph exists in this schema) and is
-- deliberately left out rather than fabricated.
create or replace function list_join_requests(p_group_id uuid)
returns table (
  id uuid,
  user_id uuid,
  display_name text,
  handle text,
  university text,
  shared_circle_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from groups where id = p_group_id;
  if v_owner_id is null then
    raise exception 'Campfire not found.';
  end if;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can view join requests.';
  end if;

  return query
  select
    r.id,
    r.user_id,
    p.display_name,
    p.handle,
    p.university,
    (
      select g2.name from group_members gm1
      join group_members gm2 on gm1.group_id = gm2.group_id
      join groups g2 on g2.id = gm1.group_id
      where gm1.user_id = r.user_id and gm2.user_id = auth.uid() and gm1.group_id <> p_group_id
      limit 1
    ) as shared_circle_name,
    r.created_at
  from group_join_requests r
  join profiles p on p.id = r.user_id
  where r.group_id = p_group_id and r.status = 'pending'
  order by r.created_at asc;
end;
$$;

-- Privacy is changeable any time, owner-only (PHILOI_UI_SPEC.md §14's transitions: -> Open
-- auto-approves pending requests; -> Private just removes it from the valley query above
-- (existing members + code untouched); -> Gated starts collecting, no side effect needed here).
create or replace function update_campfire_privacy(p_group_id uuid, p_privacy text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_group groups;
  v_req_id uuid;
begin
  if p_privacy not in ('open', 'gated', 'private') then
    raise exception 'Invalid campfire privacy.';
  end if;

  select owner_id into v_owner_id from groups where id = p_group_id;
  if v_owner_id is distinct from auth.uid() then
    raise exception 'Only the owner can change campfire privacy.';
  end if;

  update groups set privacy = p_privacy where id = p_group_id returning * into v_group;

  if p_privacy = 'open' then
    for v_req_id in select id from group_join_requests where group_id = p_group_id and status = 'pending' loop
      perform approve_join_request(v_req_id);
    end loop;
  end if;

  return v_group;
end;
$$;

-- Dev-only demo-circle seeder predates `privacy` — this is the currently-live body (verified
-- via pg_get_functiondef before editing, since schema.sql happens to redefine this same
-- function twice historically with slightly different bodies), with only the is_public ->
-- privacy swap made; not otherwise touching its goals-table-based seeding logic here.
create or replace function dev_seed_my_demo_circle()
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_fake_id uuid;
  v_goal_id uuid;
  v_day integer;
  v_found boolean := false;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, privacy)
  values ('Dev Test Circle', '🧪', auth.uid(), 'gym', '7x/week', 'private')
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  for v_fake_id in select id from profiles where is_demo = true limit 3 loop
    v_found := true;
    insert into group_members (group_id, user_id, role)
    values (v_group.id, v_fake_id, 'member')
    on conflict (group_id, user_id) do nothing;

    insert into goals (user_id, type, label)
    values (v_fake_id, 'gym', 'Gym')
    on conflict (user_id, type) where archived_at is null and type <> 'custom' do nothing;

    select id into v_goal_id from goals where user_id = v_fake_id and type = 'gym' and archived_at is null;

    for v_day in 0..2 loop
      insert into check_ins (goal_id, user_id, photo_url, status, created_at)
      values (
        v_goal_id, v_fake_id, 'dev-tools/placeholder.jpg', 'on_time',
        now() - (v_day || ' days')::interval
      );
    end loop;

    perform recompute_goal_streak(v_goal_id);
  end loop;

  if not v_found then
    raise notice 'No is_demo profiles exist yet — run `npm run seed:demo` (scripts/seed-demo-circles.js), then call dev_seed_my_demo_circle() again to actually populate members.';
  end if;

  return v_group;
end;
$$;

alter table groups drop column if exists is_public;
alter table groups drop column if exists visibility;
