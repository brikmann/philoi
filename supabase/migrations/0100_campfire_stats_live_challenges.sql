-- The campfire header's "LIVE CHALLENGES" tile, taught the v2 lifecycle vocabulary.
--
-- THE BUG THIS PREVENTS. get_campfire_stats() (migration 0079) counted a campfire's running
-- challenges as `where sc.status = 'active'`. Migration 0096 widens social_challenges.status with
-- the v2 lifecycle (draft → invited → live → settled) while keeping the legacy values, because
-- there are races already in flight carrying them. A v2 challenge that is genuinely running sits
-- at 'live', not 'active' — so the moment 0096 lands, the tile on the campfire's landing screen
-- reads 0 while a race is visibly happening two tabs away.
--
-- It fails SILENTLY, which is what makes it worth its own migration: no error, no empty state, just
-- a wrong number on the first screen you see.
--
-- ORDERING. This must run AFTER 0096 — it calls challenge_is_live(), which 0096 creates. That is
-- the whole reason the campfire pass owns 0094/0095 and then 0100+ rather than a contiguous block:
-- the dependency runs campfire roles → challenge lifecycle → campfire reads of that lifecycle, and
-- filename order has to follow it.
--
-- Calls the helper instead of inlining ('active', 'live'). One place decides what "running" means,
-- and it is not this file — when the legacy statuses are finally retired, challenge_is_live()
-- changes and this counter follows for free.

create or replace function get_campfire_stats(p_group_id uuid)
returns table (
  member_count int,
  locked_in_today int,
  avg_streak numeric,
  avg_hours_per_day numeric,
  live_challenges int
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    (select count(*)::int from group_members gm where gm.group_id = p_group_id),
    -- Same "locked in today" definition as get_my_campfire_heat(): a member with any surviving
    -- check-in dated today. The heat gauge and this counter must never disagree on screen.
    (select count(distinct gm.user_id)::int
       from group_members gm
       join check_ins ci on ci.user_id = gm.user_id
      where gm.group_id = p_group_id
        and (ci.created_at at time zone 'utc')::date = current_date
        and ci.removed_at is null),
    (select coalesce(round(avg(p.current_streak), 0), 0)
       from group_members gm
       join profiles p on p.id = gm.user_id
      where gm.group_id = p_group_id),
    -- Hours locked in per member per day, averaged over the trailing week. Divided by the CURRENT
    -- member count, so a fire that just doubled in size honestly reads as less locked-in per head.
    (select round(
              coalesce(sum(ci.duration_seconds), 0)::numeric
              / greatest((select count(*) from group_members gm2 where gm2.group_id = p_group_id), 1)
              / 7.0 / 3600.0, 1)
       from group_members gm
       join check_ins ci on ci.user_id = gm.user_id
      where gm.group_id = p_group_id
        and ci.created_at >= now() - interval '7 days'
        and ci.removed_at is null),
    -- ← the fix. Was `sc.status = 'active'`.
    (select count(*)::int
       from social_challenges sc
      where sc.circle_id = p_group_id and challenge_is_live(sc.status))
  where is_group_member(p_group_id);
$fn$;
