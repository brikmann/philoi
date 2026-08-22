-- The campfire header's "LIVE CHALLENGES" tile, routed through the challenge lifecycle helper
-- instead of a hard-coded status literal.
--
-- WHY THIS FILE HAS A GUARD IN IT. The first version of this migration called challenge_is_live()
-- directly and failed on deploy with 42883 "function challenge_is_live(text) does not exist".
-- The helper is created by 0096, which belongs to the parallel challenge-subsystem branch — so on
-- any database that has had the campfire branch pushed WITHOUT the challenge branch merged, the
-- function this file depends on has simply never been created. Filename order guarantees 0096
-- sorts before 0100; it guarantees nothing about 0096 existing.
--
-- So the dependency is made optional rather than assumed:
--   · challenge branch merged  -> 0096 creates the helper, the guard below finds it, skips.
--   · campfire branch alone    -> the guard creates it, with the same body 0096 uses.
-- Either way get_campfire_stats() below compiles, and a later 0096 `create or replace` lands on
-- top of an identical definition rather than fighting it.
--
-- WHAT THIS ACTUALLY CHANGES TODAY: nothing. It was written when the v2 lifecycle was going to add
-- a separate 'live' status alongside 'active', which would have made this tile silently read 0
-- while a race was running. The challenge branch then collapsed that fork — v2 adds only 'draft',
-- and challenge_is_live() is now exactly `status = 'active'`, the same test 0079 already made. The
-- migration is kept because the POINT is the indirection: when 'active' is eventually retired, the
-- helper changes and this counter follows, instead of being one more literal nobody audits.

do $mig$
begin
  -- to_regprocedure returns null rather than raising when the function is absent, which is the
  -- whole reason to use it here instead of a catalog join or a regprocedure cast.
  if to_regprocedure('public.challenge_is_live(text)') is null then
    execute $ddl$
      create function challenge_is_live(p_status text)
      returns boolean language sql immutable as $body$ select p_status = 'active'; $body$
    $ddl$;
  end if;
end
$mig$;

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
    -- Was `sc.status = 'active'`. Same result today, one place to change tomorrow.
    (select count(*)::int
       from social_challenges sc
      where sc.circle_id = p_group_id and challenge_is_live(sc.status))
  where is_group_member(p_group_id);
$fn$;
