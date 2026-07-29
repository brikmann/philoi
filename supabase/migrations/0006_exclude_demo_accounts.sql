-- Follow-up to 0005_dashboard_fixes.sql — this file is a historical, reviewable snapshot;
-- supabase/schema.sql is the real deploy artifact and carries the identical statements.
-- Run the whole of schema.sql, not this file, against a project.
--
-- Two bugs found while sanity-checking the beta metrics dashboard (2026-07-20):
--
-- 1. None of the analytics_* views (nor analytics_top_circles) excluded profiles.is_demo
--    — the flag scripts/seed-demo-circles.js sets on the four public "fitness circle"
--    personas (Jordan/Sam/Riley/Casey) it creates so cold-start discovery has something
--    to show brand-new users. Those accounts and their circles were counting toward
--    signups, DAU/WAU, retention, the activation funnel, and top circles.
--
-- 2. schema.sql had a *second*, unfiltered redefinition of analytics_daily_active_users /
--    analytics_weekly_active_users later in the file. Since `create or replace view` is
--    order-dependent, that stray copy silently won over the filtered ones defined earlier
--    — meaning DAU/WAU in production weren't excluding even is_admin/is_test, let alone
--    is_demo. The stray copy is deleted in schema.sql; this migration re-asserts the
--    correct (filtered) versions so a project that already ran 0005 gets the fix applied
--    last, regardless of what order schema.sql historically had them in.
--
-- 3. Founder/team accounts should be excluded the same way, not just demo personas —
--    noahbrikman@gmail.com is added to the is_admin seed alongside spikeythedoge1@gmail.com
--    so his usage doesn't count toward the metrics either (he already gets admin-dashboard
--    access from this, matching the founder account's treatment).
--
-- 4. That seed was a plain UPDATE, which no-ops if the profiles row doesn't exist yet.
--    Nothing auto-creates one on signup (only the mobile app's onboarding flow does,
--    client-side) — a founder who only ever signs into admin/ directly has no profiles
--    row for an UPDATE to touch, so it silently did nothing and they landed on
--    /not-authorized. Changed to an upsert.

insert into profiles (id, display_name, is_admin)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  true
from auth.users u
where u.email in ('spikeythedoge1@gmail.com', 'noahbrikman@gmail.com')
on conflict (id) do update set is_admin = true;

create or replace view analytics_daily_signups as
select date_trunc('day', created_at)::date as day, count(*) as signups
from profiles
where not is_admin and not is_test and not is_demo
group by 1
order by 1;

create or replace view analytics_event_counts as
select e.name, date_trunc('day', e.created_at)::date as day, count(*) as count
from events e
left join profiles p on p.id = e.user_id
where e.user_id is null or (not p.is_admin and not p.is_test and not p.is_demo)
group by 1, 2
order by 2 desc, 1;

create or replace view analytics_retention as
with signups as (
  select id as user_id, date_trunc('day', created_at)::date as signup_day
  from profiles
  where not is_admin and not is_test and not is_demo
),
activity as (
  select e.user_id, date_trunc('day', e.created_at)::date as active_day
  from events e
  join profiles p on p.id = e.user_id
  where not p.is_admin and not p.is_test and not p.is_demo
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
  (select count(*) from profiles where not is_admin and not is_test and not is_demo) as total_signups,
  (select count(*) from events e join profiles p on p.id = e.user_id
     where e.name = 'invite_sent' and not p.is_admin and not p.is_test and not p.is_demo) as invites_sent,
  (select count(*) from events e join profiles p on p.id = e.user_id
     where e.name = 'invite_accepted' and not p.is_admin and not p.is_test and not p.is_demo) as invites_accepted,
  round(
    (select count(*) from events e join profiles p on p.id = e.user_id
       where e.name = 'invite_accepted' and not p.is_admin and not p.is_test and not p.is_demo)::numeric
    / greatest((select count(*) from profiles where not is_admin and not is_test and not is_demo), 1),
    3
  ) as viral_coefficient;

create or replace view analytics_daily_active_users as
select date_trunc('day', e.created_at)::date as day, count(distinct e.user_id) as dau
from events e
join profiles p on p.id = e.user_id
where e.user_id is not null and not p.is_admin and not p.is_test and not p.is_demo
group by 1
order by 1;

create or replace view analytics_weekly_active_users as
select date_trunc('week', e.created_at)::date as week, count(distinct e.user_id) as wau
from events e
join profiles p on p.id = e.user_id
where e.user_id is not null and not p.is_admin and not p.is_test and not p.is_demo
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
where not p.is_admin and not p.is_test and not p.is_demo
group by 1
order by signups desc;

create or replace view analytics_activation_funnel as
with base as (
  select id as user_id from profiles where not is_admin and not is_test and not is_demo
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
where not p.is_admin and not p.is_test and not p.is_demo
group by p.id, p.display_name, p.handle, p.university
order by last_active_at asc nulls first;

create or replace view analytics_top_circles as
with ci_agg as (
  select
    cic.circle_id as group_id,
    count(*) filter (where ci.created_at >= now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
    count(*) filter (where ci.removed_at is null) as check_ins_total
  from check_in_circles cic
  join check_ins ci on ci.id = cic.check_in_id
  join profiles p on p.id = ci.user_id
  where not p.is_admin and not p.is_test and not p.is_demo
  group by cic.circle_id
),
mem_agg as (
  select gm.group_id, count(distinct gm.user_id) as member_count
  from group_members gm
  join profiles p on p.id = gm.user_id
  where not p.is_admin and not p.is_test and not p.is_demo
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
