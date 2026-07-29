-- Living-flame signature mechanic (UI_REDESIGN_SPEC.md) — this file is a historical,
-- reviewable snapshot; supabase/schema.sql is the real deploy artifact and carries the
-- identical statements. Run the whole of schema.sql, not this file, against a project.
--
-- Each Campfire's flame is meant to be a LIVE gauge of the group's activity, not decoration:
-- roars when members are showing up today, dies down when nobody has. Blended from two
-- signals — what fraction of the group checked in today (immediate, volatile) and the
-- group's average current streak (slower-moving, rewards consistency) — so a single
-- no-show day dims the flame without snuffing it outright if the group's streaks are healthy.
create or replace function get_my_campfire_heat()
returns table (group_id uuid, heat numeric)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.group_id,
    least(
      1.0,
      (coalesce(today.today_count, 0)::numeric / greatest(mem.member_count, 1)) * 0.7
      + least(coalesce(streak.avg_streak, 0) / 14.0, 1.0) * 0.3
    ) as heat
  from group_members gm
  join (
    select group_id, count(*) as member_count from group_members group by group_id
  ) mem on mem.group_id = gm.group_id
  left join (
    select gm2.group_id, count(distinct gm2.user_id) as today_count
    from group_members gm2
    join check_ins ci on ci.user_id = gm2.user_id
    where (ci.created_at at time zone 'utc')::date = current_date and ci.removed_at is null
    group by gm2.group_id
  ) today on today.group_id = gm.group_id
  left join (
    select gm3.group_id, avg(g.current_streak) as avg_streak
    from group_members gm3
    join goals g on g.user_id = gm3.user_id and g.archived_at is null
    group by gm3.group_id
  ) streak on streak.group_id = gm.group_id
  where gm.user_id = auth.uid();
$$;
