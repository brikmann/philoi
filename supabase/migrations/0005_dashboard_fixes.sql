-- Fixes from admin/DASHBOARD_FIXES.md (review dated 2026-07-20).
--
-- This file is a historical, reviewable snapshot — supabase/schema.sql is the real
-- deploy artifact and carries the identical statements. Run the whole of schema.sql, not
-- this file, against a project.

-- P0-2: seed/QA account flag, excluded (alongside is_admin) from every analytics_* view.
alter table profiles add column if not exists is_test boolean not null default false;

-- P0-1 + P0-2: analytics_top_circles — check-ins/members aggregated in their own
-- subqueries (previous version joined check_ins to group_members on user_id alone, with
-- no per-circle constraint on either side, so every member's entire check-in history got
-- attributed to every circle they belonged to — inflating check_ins_7d/check_ins_total by
-- roughly member_count). Check-ins don't carry a group_id directly (goals refactor — a
-- check-in belongs to a personal goal); circle attribution goes through check_in_circles,
-- the same point-in-time fan-out table the circle Feed tab reads from. Also excludes
-- admin/test accounts from both check-ins and membership counts.
create or replace view analytics_top_circles as
with ci_agg as (
  select
    cic.circle_id as group_id,
    count(*) filter (where ci.created_at >= now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
    count(*) filter (where ci.removed_at is null) as check_ins_total
  from check_in_circles cic
  join check_ins ci on ci.id = cic.check_in_id
  join profiles p on p.id = ci.user_id
  where not p.is_admin and not p.is_test
  group by cic.circle_id
),
mem_agg as (
  select gm.group_id, count(distinct gm.user_id) as member_count
  from group_members gm
  join profiles p on p.id = gm.user_id
  where not p.is_admin and not p.is_test
  group by gm.group_id
)
select
  g.id as group_id,
  g.name,
  g.emoji,
  coalesce(ci_agg.check_ins_7d, 0) as check_ins_7d,
  coalesce(ci_agg.check_ins_total, 0) as check_ins_total,
  coalesce(mem_agg.member_count, 0) as member_count
from groups g
left join ci_agg on ci_agg.group_id = g.id
left join mem_agg on mem_agg.group_id = g.id
order by check_ins_7d desc;

-- P0-2: exclude admin/test from every remaining analytics_* view.
create or replace view analytics_daily_signups as
select date_trunc('day', created_at)::date as day, count(*) as signups
from profiles
where not is_admin and not is_test
group by 1
order by 1;

create or replace view analytics_event_counts as
select e.name, date_trunc('day', e.created_at)::date as day, count(*) as count
from events e
left join profiles p on p.id = e.user_id
where e.user_id is null or (not p.is_admin and not p.is_test)
group by 1, 2
order by 2 desc, 1;

create or replace view analytics_retention as
with signups as (
  select id as user_id, date_trunc('day', created_at)::date as signup_day
  from profiles
  where not is_admin and not is_test
),
activity as (
  select e.user_id, date_trunc('day', e.created_at)::date as active_day
  from events e
  join profiles p on p.id = e.user_id
  where not p.is_admin and not p.is_test
  group by 1, 2
)
select
  s.signup_day,
  count(distinct s.user_id) as cohort_size,
  count(distinct a1.user_id) as d1_active,
  count(distinct a7.user_id) as d7_active,
  round(100.0 * count(distinct a1.user_id) / greatest(count(distinct s.user_id), 1), 1) as d1_retention_pct,
  round(100.0 * count(distinct a7.user_id) / greatest(count(distinct s.user_id), 1), 1) as d7_retention_pct
from signups s
left join activity a1 on a1.user_id = s.user_id and a1.active_day = s.signup_day + 1
left join activity a7 on a7.user_id = s.user_id and a7.active_day = s.signup_day + 7
group by s.signup_day
order by s.signup_day;

create or replace view analytics_viral_coefficient as
select
  (select count(*) from profiles where not is_admin and not is_test) as total_signups,
  (select count(*) from events e join profiles p on p.id = e.user_id
     where e.name = 'invite_sent' and not p.is_admin and not p.is_test) as invites_sent,
  (select count(*) from events e join profiles p on p.id = e.user_id
     where e.name = 'invite_accepted' and not p.is_admin and not p.is_test) as invites_accepted,
  round(
    (select count(*) from events e join profiles p on p.id = e.user_id
       where e.name = 'invite_accepted' and not p.is_admin and not p.is_test)::numeric
    / greatest((select count(*) from profiles where not is_admin and not is_test), 1),
    3
  ) as viral_coefficient;

create or replace view analytics_daily_active_users as
select date_trunc('day', e.created_at)::date as day, count(distinct e.user_id) as dau
from events e
join profiles p on p.id = e.user_id
where e.user_id is not null and not p.is_admin and not p.is_test
group by 1
order by 1;

create or replace view analytics_weekly_active_users as
select date_trunc('week', e.created_at)::date as week, count(distinct e.user_id) as wau
from events e
join profiles p on p.id = e.user_id
where e.user_id is not null and not p.is_admin and not p.is_test
group by 1
order by 1;

create or replace view analytics_by_university as
select
  coalesce(p.university, 'Unspecified') as university,
  count(distinct p.id) as signups,
  count(distinct ci.id) filter (where ci.created_at > now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
  count(distinct e.user_id) filter (where e.created_at > now() - interval '7 days') as active_7d
from profiles p
left join check_ins ci on ci.user_id = p.id
left join events e on e.user_id = p.id
where not p.is_admin and not p.is_test
group by 1
order by signups desc;

-- P1-1: activation funnel — signed up -> joined/created a circle -> set a goal -> first
-- check-in. Step 1 counts from profiles rather than the signed_up event so it isn't
-- undercounted if that event ever fails to fire client-side.
create or replace view analytics_activation_funnel as
with base as (
  select id as user_id from profiles where not is_admin and not is_test
),
joined_circle as (
  select distinct e.user_id
  from events e
  join base b on b.user_id = e.user_id
  where e.name in ('circle_joined', 'circle_created')
),
set_goal as (
  select distinct e.user_id
  from events e
  join base b on b.user_id = e.user_id
  where e.name = 'goal_created'
),
checked_in as (
  select distinct e.user_id
  from events e
  join base b on b.user_id = e.user_id
  where e.name = 'first_check_in'
)
select 1 as step_order, 'Signed up' as step, count(*) as users from base
union all
select 2, 'Joined/created a circle', count(*) from joined_circle
union all
select 3, 'Set a goal', count(*) from set_goal
union all
select 4, 'First check-in', count(*) from checked_in
order by step_order;

-- P1-2: per-user last-active roster, stalest first (nulls, i.e. never active, sort
-- first). "Active" = an event OR a non-removed check-in, whichever is more recent.
create or replace view analytics_user_last_active as
select
  p.id as user_id,
  p.display_name,
  p.handle,
  p.university,
  greatest(max(e.created_at), max(ci.created_at)) as last_active_at
from profiles p
left join events e on e.user_id = p.id
left join check_ins ci on ci.user_id = p.id and ci.removed_at is null
where not p.is_admin and not p.is_test
group by p.id, p.display_name, p.handle, p.university
order by last_active_at asc nulls first;
