-- Per-campus adoption view for the admin metrics dashboard. The initial beta cohort is
-- concentrated on three campuses (UofT / UW / Laurier) that fan out through in-person
-- friend groups, so campus is the natural unit to watch for early traction.
--
-- This file is a historical, reviewable snapshot — supabase/schema.sql is the real
-- deploy artifact and carries the identical statement. Run the whole of schema.sql, not
-- this file, against a project.

create or replace view analytics_by_university as
select
  coalesce(p.university, 'Unspecified') as university,
  count(distinct p.id) as signups,
  count(distinct ci.id) filter (where ci.created_at > now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
  count(distinct e.user_id) filter (where e.created_at > now() - interval '7 days') as active_7d
from profiles p
left join check_ins ci on ci.user_id = p.id
left join events e on e.user_id = p.id
group by 1
order by signups desc;
