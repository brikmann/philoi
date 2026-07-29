-- Class-tagged campfires (PHILOI_UI_SPEC.md §14, design-mocks/10) — a course study-hall is
-- just a regular campfire with course_code/school metadata + a per-membership helper flag.
-- Searchable/discoverable by course code + school so a class's campfire groups cleanly
-- instead of fragmenting into many differently-named campfires for the same course.

alter table groups add column if not exists course_code text;
alter table groups add column if not exists school text;
create index if not exists groups_course_school_idx on groups (course_code, school) where course_code is not null;

alter table group_members add column if not exists is_helper boolean not null default false;

-- Signature changed (added p_course_code/p_school) — drop first, same treatment every
-- signature change in this file gets. Also drops a stale 4-arg overload (no p_is_public)
-- left over from before that parameter existed — discovered live via pg_get_function_arguments
-- when this migration's own drop left a duplicate overload behind.
drop function if exists create_group_with_owner(text, text, text, text, boolean);
drop function if exists create_group_with_owner(text, text, text, text);
create function create_group_with_owner(
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_is_public boolean default false,
  p_course_code text default null,
  p_school text default null
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, is_public, course_code, school)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence, coalesce(p_is_public, false), p_course_code, p_school)
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  insert into invites (code, inviter_id, group_id)
  values (v_group.join_code, auth.uid(), v_group.id);

  return v_group;
end;
$$;

-- RPC-gated (not a direct "update own row" policy) for the same reason set_chat_muted() is —
-- group_members has no general update policy.
create or replace function set_my_helper_flag(p_group_id uuid, p_is_helper boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
  set is_helper = p_is_helper
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Signature changed (added p_course_code + course_code/school in the return shape) — drop
-- first.
drop function if exists get_discoverable_groups(text, int, text);
create function get_discoverable_groups(
  p_goal_type text default null,
  p_limit int default 20,
  p_search text default null
)
returns table (
  id uuid,
  name text,
  emoji text,
  goal_type text,
  cadence text,
  member_count bigint,
  owner_university text,
  course_code text,
  school text
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
    g.school
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
