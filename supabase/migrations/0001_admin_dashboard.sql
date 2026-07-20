-- ───────────────────────────── admin dashboard ─────────────────────────────
-- Backs the separate admin/ Next.js dashboard.
--
-- profiles.is_admin, is_admin(), profiles.is_disabled/disabled_at (+ its
-- lock_profile_moderation_fields() protection trigger), check_ins.removed_at, the
-- generated moderation_reports.category, and the moderation_actions.action_type
-- constraint are defined in the chat-safety section of schema.sql (built alongside this
-- dashboard against the same spec) — this migration only adds what that section
-- explicitly leaves to the dashboard: the first-admin seed, admin-read RLS policies on
-- the tables the dashboard browses, a transactional report-resolution RPC, a dedicated
-- audit log, and analytics views the existing ones don't cover (distinct-user DAU/WAU,
-- top circles by activity).
--
-- This file is a historical, reviewable snapshot of the change — the actual deploy
-- mechanism for this project is still "run the whole of supabase/schema.sql", which
-- carries the identical statements below in its own admin-dashboard section. Don't
-- expect this file to be re-run by tooling; it exists for the record, not as tracked
-- migration state.

-- ── seed first admin (idempotent no-op if this user hasn't signed up yet) ──
update profiles set is_admin = true
where id = (select id from auth.users where email = 'spikeythedoge1@gmail.com')
  and is_admin = false;

-- ── admin read access via is_admin(), so the dashboard's day-to-day reads run under the
-- signed-in admin's own session + RLS rather than the service-role key. ──
drop policy if exists "moderation_reports: admin read" on moderation_reports;
create policy "moderation_reports: admin read" on moderation_reports for select using (is_admin());

drop policy if exists "moderation_reports: admin update" on moderation_reports;
create policy "moderation_reports: admin update" on moderation_reports for update using (is_admin());

drop policy if exists "moderation_actions: admin read" on moderation_actions;
create policy "moderation_actions: admin read" on moderation_actions for select using (is_admin());

drop policy if exists "moderation_actions: admin insert" on moderation_actions;
create policy "moderation_actions: admin insert" on moderation_actions for insert with check (is_admin());

drop policy if exists "groups: admin read" on groups;
create policy "groups: admin read" on groups for select using (is_admin());

drop policy if exists "check_ins: admin read" on check_ins;
create policy "check_ins: admin read" on check_ins for select using (is_admin());

drop policy if exists "messages: admin read" on messages;
create policy "messages: admin read" on messages for select using (is_admin());

drop policy if exists "group_members: admin read" on group_members;
create policy "group_members: admin read" on group_members for select using (is_admin());

drop policy if exists "events: admin read" on events;
create policy "events: admin read" on events for select using (is_admin());

-- ── actually disables a user's account — the function account-disabled.tsx and
-- lock_profile_moderation_fields() already reference in their comments as the thing
-- allowed to set is_disabled/disabled_at. Kept separate from admin_resolve_report so it
-- can be called with just a user id if a future flow needs to disable an account outside
-- the report queue. No Auth Admin API / service-role key involved: is_disabled is
-- already enforced via RLS ("messages: insert own if member") and via the mobile
-- client's Stack.Protected redirect to account-disabled.tsx. ──
create or replace function admin_disable_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;

  update profiles set is_disabled = true, disabled_at = now() where id = p_user_id;
end;
$$;

-- ── resolve a report: soft-delete the reported content (if any) or disable the
-- reported user, log the action, and flip the report's status — all in one SECURITY
-- DEFINER call so an action can't half-apply. ──
create or replace function admin_resolve_report(
  p_report_id uuid,
  p_action_type text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report moderation_reports;
begin
  if not is_admin() then
    raise exception 'Not authorized.';
  end if;

  if p_action_type not in ('removed_content', 'disabled_account', 'reported_to_authorities', 'dismissed', 'warned') then
    raise exception 'Unknown action_type: %', p_action_type;
  end if;

  select * into v_report from moderation_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Report not found.';
  end if;

  if p_action_type = 'removed_content' then
    if v_report.reported_message_id is not null then
      update messages set deleted_at = now() where id = v_report.reported_message_id and deleted_at is null;
    elsif v_report.reported_check_in_id is not null then
      update check_ins set removed_at = now() where id = v_report.reported_check_in_id and removed_at is null;
    end if;
  elsif p_action_type = 'disabled_account' then
    if v_report.reported_user_id is null then
      raise exception 'This report has no target user to disable.';
    end if;
    perform admin_disable_account(v_report.reported_user_id);
  end if;

  insert into moderation_actions (report_id, action_type, target_user_id, notes)
  values (p_report_id, p_action_type, v_report.reported_user_id, p_notes);

  update moderation_reports
  set status = case when p_action_type = 'dismissed' then 'dismissed' else 'actioned' end
  where id = p_report_id;
end;
$$;

-- ── dedicated audit log — separate from moderation_actions (whose action_type check
-- constraint is scoped to report-resolution outcomes) since content *views* and logins
-- don't fit that shape. Every admin content view and action lands here. ──
create table if not exists admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references profiles (id) on delete set null,
  event_type text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on admin_audit (created_at desc);
create index if not exists admin_audit_admin_idx on admin_audit (admin_id, created_at desc);

alter table admin_audit enable row level security;

drop policy if exists "admin_audit: admin insert" on admin_audit;
create policy "admin_audit: admin insert" on admin_audit for insert with check (is_admin() and admin_id = auth.uid());

drop policy if exists "admin_audit: admin read" on admin_audit;
create policy "admin_audit: admin read" on admin_audit for select using (is_admin());

-- ── metrics: analytics_event_counts only gives count(*) per name+day, not distinct
-- users, so DAU/WAU need their own views. ──
create or replace view analytics_daily_active_users as
select date_trunc('day', created_at)::date as day, count(distinct user_id) as dau
from events
where user_id is not null
group by 1
order by 1;

create or replace view analytics_weekly_active_users as
select date_trunc('week', created_at)::date as week, count(distinct user_id) as wau
from events
where user_id is not null
group by 1
order by 1;

-- ── admin storage read — the moderation queue and content browser need to render
-- check-in photos for reports/circles an admin isn't necessarily a member of; the
-- existing "check-in-photos: read if member" policy alone won't cover that. ──
drop policy if exists "check-in-photos: admin read" on storage.objects;
create policy "check-in-photos: admin read" on storage.objects for select
  using (bucket_id = 'check-in-photos' and is_admin());

-- ── active circles / top circles by check-in activity ──
create or replace view analytics_top_circles as
select
  g.id as group_id,
  g.name,
  g.emoji,
  count(ci.id) filter (where ci.created_at >= now() - interval '7 days' and ci.removed_at is null) as check_ins_7d,
  count(ci.id) filter (where ci.removed_at is null) as check_ins_total,
  count(distinct gm.user_id) as member_count
from groups g
left join check_ins ci on ci.group_id = g.id
left join group_members gm on gm.group_id = g.id
group by g.id, g.name, g.emoji
order by check_ins_7d desc;
