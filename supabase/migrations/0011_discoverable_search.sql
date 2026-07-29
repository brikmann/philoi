-- Discoverable-circle search (UI_REDESIGN_SPEC.md / V1_BUILD_SPEC.md's "native search"
-- item) — this file is a historical, reviewable snapshot; supabase/schema.sql is the real
-- deploy artifact and carries the identical statements. Run the whole of schema.sql, not
-- this file, against a project.
--
-- Adds an optional name search on top of the existing goal-type filter. Turns out appending
-- a new parameter is NOT safe via plain CREATE OR REPLACE either — Postgres treats a
-- different parameter-type list as a distinct overload rather than replacing the old one,
-- so without this explicit drop the old 2-arg version would keep existing alongside the new
-- 3-arg one. Same lesson as get_my_ranks/stop_lock_in_session earlier this session, just a
-- different flavor of signature change.
drop function if exists get_discoverable_groups(text, int);

create or replace function get_discoverable_groups(p_goal_type text default null, p_limit int default 20, p_search text default null)
returns table (
  id uuid,
  name text,
  emoji text,
  goal_type text,
  cadence text,
  member_count bigint,
  owner_university text
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
    owner.university as owner_university
  from groups g
  join profiles owner on owner.id = g.owner_id
  where g.is_public = true
    and not exists (
      select 1 from group_members gm
      where gm.group_id = g.id and gm.user_id = auth.uid()
    )
    and (p_goal_type is null or g.goal_type = p_goal_type)
    and (p_search is null or g.name ilike '%' || p_search || '%')
  order by
    (owner.university is not null and owner.university = (select p.university from profiles p where p.id = auth.uid())) desc,
    g.created_at desc
  limit p_limit;
$$;
