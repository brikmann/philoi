-- Philoi — core schema, RLS, and RPCs.
-- Run this whole file once in the Supabase SQL editor (or `supabase db push`
-- if you set up the CLI). Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ───────────────────────────── tables ─────────────────────────────

-- profiles.is_pro / pro_until now mean "has an active paid Philoi membership"
-- (hard paywall after the trial window — see TRIAL_DAYS in src/lib/billing.ts),
-- not a cosmetic upsell tier.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique,
  display_name text not null,
  avatar_url text,
  university text,
  is_pro boolean not null default false,
  pro_until timestamptz,
  -- Legal / store requirements: 18+ attestation + consent to Terms/Privacy.
  -- Null = user signed up before this gate existed (treat as needing consent).
  has_consented boolean not null default false,
  consented_at timestamptz,
  consent_version text,  -- policy version string, e.g. "2026-06-30"
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists has_consented boolean not null default false;
alter table profiles add column if not exists consented_at timestamptz;
alter table profiles add column if not exists consent_version text;

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🔥',
  owner_id uuid not null references profiles (id) on delete cascade,
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  goal_type text not null default 'custom' check (goal_type in ('gym', 'run', 'study', 'custom')),
  cadence text not null default '7x/week',
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

-- Additive columns for projects that already ran this file before university/is_public existed.
alter table profiles add column if not exists university text;
alter table groups add column if not exists is_public boolean not null default false;

create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  -- Personal target within the circle — e.g. "A in CHEM101" for a study group. Self-reported,
  -- set via set_my_goal_target() (not a direct column update — see RLS note below).
  goal_target text,
  primary key (group_id, user_id)
);

alter table group_members add column if not exists goal_target text;

create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  photo_url text not null,
  caption text,
  status text not null default 'on_time' check (status in ('on_time', 'late'))
);

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (check_in_id, user_id, emoji)
);

create table if not exists invites (
  code text primary key default upper(substr(md5(random()::text), 1, 6)),
  inviter_id uuid not null references profiles (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Traction analytics — see src/lib/analytics.ts track() and the analytics_* views below.
-- No read policy for normal users on purpose: query this via the SQL editor / table editor
-- (service role bypasses RLS), not from the client.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  -- No enum check — the event vocabulary is still settling (see AnalyticsEventName in
  -- src/types/database.ts for the current set); a DB check constraint just adds migration
  -- friction every time it changes. PostHog is the source of truth for analysis anyway.
  name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table events drop constraint if exists events_name_check;

create index if not exists check_ins_group_created_idx on check_ins (group_id, created_at desc);
create index if not exists check_ins_user_group_idx on check_ins (user_id, group_id, created_at desc);
create index if not exists reactions_check_in_idx on reactions (check_in_id);
create index if not exists events_user_created_idx on events (user_id, created_at desc);
create index if not exists events_name_created_idx on events (name, created_at desc);

-- ───────────────────────── helper: membership check ─────────────────────────

create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

-- ───────────────────────────── RLS ─────────────────────────────

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table check_ins enable row level security;
alter table reactions enable row level security;
alter table invites enable row level security;
alter table events enable row level security;

drop policy if exists "profiles: read any" on profiles;
create policy "profiles: read any" on profiles for select using (true);

drop policy if exists "profiles: update own" on profiles;
create policy "profiles: update own" on profiles for update using (id = auth.uid());

drop policy if exists "profiles: insert own" on profiles;
create policy "profiles: insert own" on profiles for insert with check (id = auth.uid());

drop policy if exists "groups: read if member" on groups;
create policy "groups: read if member" on groups for select using (is_group_member(id));

drop policy if exists "groups: read if public" on groups;
create policy "groups: read if public" on groups for select using (is_public = true);

drop policy if exists "groups: insert as self" on groups;
create policy "groups: insert as self" on groups for insert with check (owner_id = auth.uid());

drop policy if exists "groups: owner can update" on groups;
create policy "groups: owner can update" on groups for update using (owner_id = auth.uid());

drop policy if exists "groups: owner can delete" on groups;
create policy "groups: owner can delete" on groups for delete using (owner_id = auth.uid());

drop policy if exists "group_members: read if member" on group_members;
create policy "group_members: read if member" on group_members for select using (is_group_member(group_id));

drop policy if exists "group_members: insert self" on group_members;
create policy "group_members: insert self" on group_members for insert with check (user_id = auth.uid());

-- Members can leave; owners must delete the whole circle instead (avoids an orphaned circle).
drop policy if exists "group_members: leave if not owner" on group_members;
create policy "group_members: leave if not owner" on group_members for delete using (
  user_id = auth.uid() and role <> 'owner'
);

drop policy if exists "check_ins: read if member" on check_ins;
create policy "check_ins: read if member" on check_ins for select using (is_group_member(group_id));

drop policy if exists "check_ins: insert own if member" on check_ins;
create policy "check_ins: insert own if member" on check_ins for insert
  with check (user_id = auth.uid() and is_group_member(group_id));

drop policy if exists "reactions: read if member" on reactions;
create policy "reactions: read if member" on reactions for select using (
  exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id and is_group_member(check_ins.group_id)
  )
);

drop policy if exists "reactions: insert own if member" on reactions;
create policy "reactions: insert own if member" on reactions for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from check_ins
    where check_ins.id = reactions.check_in_id and is_group_member(check_ins.group_id)
  )
);

drop policy if exists "reactions: delete own" on reactions;
create policy "reactions: delete own" on reactions for delete using (user_id = auth.uid());

drop policy if exists "invites: read own or for my groups" on invites;
create policy "invites: read own or for my groups" on invites for select using (
  inviter_id = auth.uid() or (group_id is not null and is_group_member(group_id))
);

drop policy if exists "invites: insert own" on invites;
create policy "invites: insert own" on invites for insert with check (inviter_id = auth.uid());

drop policy if exists "events: insert own" on events;
create policy "events: insert own" on events for insert with check (user_id = auth.uid());

-- ───────────────────────────── streak trigger ─────────────────────────────

create or replace function recompute_streak(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dates date[];
  v_streak integer := 0;
  v_longest integer := 0;
  v_expected date := current_date;
  d date;
begin
  select array_agg(distinct (created_at at time zone 'utc')::date order by (created_at at time zone 'utc')::date desc)
  into v_dates
  from check_ins
  where group_id = p_group_id and user_id = p_user_id;

  if v_dates is null then
    update group_members set current_streak = 0 where group_id = p_group_id and user_id = p_user_id;
    return;
  end if;

  -- Current streak: consecutive days ending today or yesterday (today's check-in is optional
  -- until the day is over, so a missed "today" doesn't zero out yesterday's streak).
  if v_dates[1] = current_date or v_dates[1] = current_date - 1 then
    v_expected := v_dates[1];
    foreach d in array v_dates loop
      if d = v_expected then
        v_streak := v_streak + 1;
        v_expected := v_expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  -- Longest streak: longest run of consecutive days anywhere in history.
  v_longest := 1;
  declare
    v_run integer := 1;
    i integer;
  begin
    for i in 2 .. array_length(v_dates, 1) loop
      if v_dates[i] = v_dates[i - 1] - 1 then
        v_run := v_run + 1;
      else
        v_run := 1;
      end if;
      if v_run > v_longest then
        v_longest := v_run;
      end if;
    end loop;
  end;

  update group_members
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_longest, v_streak)
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function handle_check_in_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recompute_streak(new.group_id, new.user_id);
  return new;
end;
$$;

drop trigger if exists on_check_in_insert on check_ins;
create trigger on_check_in_insert
  after insert on check_ins
  for each row execute function handle_check_in_insert();

-- ───────────────────────────── RPCs ─────────────────────────────

create or replace function create_group_with_owner(
  p_name text,
  p_emoji text,
  p_goal_type text,
  p_cadence text,
  p_is_public boolean default false
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  insert into groups (name, emoji, owner_id, goal_type, cadence, is_public)
  values (p_name, coalesce(p_emoji, '🔥'), auth.uid(), p_goal_type, p_cadence, coalesce(p_is_public, false))
  returning * into v_group;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'owner');

  insert into invites (code, inviter_id, group_id)
  values (v_group.join_code, auth.uid(), v_group.id);

  return v_group;
end;
$$;

create or replace function join_group_with_code(p_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  select * into v_group from groups where join_code = upper(p_code);

  if v_group.id is null then
    raise exception 'No group found for that code.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

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
  select * into v_group from groups where id = p_group_id and is_public = true;

  if v_group.id is null then
    raise exception 'That circle is not open for discovery.';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group;
end;
$$;

-- Cold-start discovery: public circles the caller isn't already in yet,
-- ranked by same-university match first, then by goal type match, then recency.
create or replace function get_discoverable_groups(p_goal_type text default null, p_limit int default 20)
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
  order by
    (owner.university is not null and owner.university = (select p.university from profiles p where p.id = auth.uid())) desc,
    g.created_at desc
  limit p_limit;
$$;

create or replace function ensure_personal_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select code into v_code from invites where inviter_id = auth.uid() and group_id is null limit 1;

  if v_code is null then
    insert into invites (inviter_id, group_id) values (auth.uid(), null) returning code into v_code;
  end if;

  return v_code;
end;
$$;

-- Personal target inside a circle (e.g. "A in CHEM101") — RPC-gated rather than a direct
-- "update own row" RLS policy, so members can't also use that policy to self-edit their streaks.
create or replace function set_my_goal_target(p_group_id uuid, p_goal_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
  set goal_target = nullif(trim(p_goal_target), '')
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- Deleting a group cascades to group_members/check_ins/reactions/invites for every member,
-- not just the owner's own rows — RLS on those tables only ever permits touching your own
-- row, so a plain client-side `delete from groups` gets blocked mid-cascade and the whole
-- transaction rolls back. Security definer bypasses that for this one owner-gated operation.
create or replace function delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from groups where id = p_group_id and owner_id = auth.uid()) then
    raise exception 'Only the owner can delete this circle.';
  end if;

  delete from groups where id = p_group_id;
end;
$$;

-- Wipes everything tied to the caller's account: their circles (cascade), memberships,
-- check-ins, reactions, invites, events, and finally the profile row + auth user.
-- SECURITY DEFINER so the cascade can cross table-owner RLS boundaries (same reason as
-- delete_group). This is required by Google Play + Apple in-app account deletion policy.
-- Hard-deletes immediately; Storage photos are orphaned and should be cleaned up by a
-- scheduled job or Cloud Function within 30 days per the Privacy Policy.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  -- Delete circles the caller owns (cascades to group_members, check_ins, reactions, invites).
  delete from groups where owner_id = v_user_id;

  -- Remove memberships in circles owned by others (doesn't touch other members' data).
  delete from group_members where user_id = v_user_id;

  -- Remaining direct rows.
  delete from reactions where user_id = v_user_id;
  delete from check_ins where user_id = v_user_id;
  delete from invites where inviter_id = v_user_id;
  delete from events where user_id = v_user_id;
  delete from profiles where id = v_user_id;

  -- Remove the auth user last — this invalidates the JWT so no further requests succeed.
  delete from auth.users where id = v_user_id;
end;
$$;

-- Dropped first: CREATE OR REPLACE can't change an existing function's RETURNS TABLE columns
-- (this file originally shipped get_group_leaderboard without goal_target).
drop function if exists get_group_leaderboard(uuid);

create function get_group_leaderboard(p_group_id uuid)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  current_streak integer,
  goal_target text,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    gm.user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    gm.current_streak,
    gm.goal_target,
    coalesce((
      select count(*) from check_ins ci
      where ci.group_id = p_group_id
        and ci.user_id = gm.user_id
        and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = p_group_id and is_group_member(p_group_id)
  order by gm.current_streak desc, check_ins_this_week desc, p.display_name asc;
$$;

create or replace function get_weekly_recap(p_user_id uuid)
returns table (
  group_id uuid,
  group_name text,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.id as group_id,
    g.name as group_name,
    count(ci.id) as check_ins_this_week
  from group_members gm
  join groups g on g.id = gm.group_id
  left join check_ins ci on ci.group_id = gm.group_id
    and ci.user_id = p_user_id
    and ci.created_at >= date_trunc('week', now())
  where gm.user_id = p_user_id and p_user_id = auth.uid()
  group by g.id, g.name;
$$;

-- School-wide leaderboard: ranks every member.university match by their single best
-- active streak across any circle (not summed — joining lots of circles shouldn't itself
-- improve rank), tie-broken by total check-ins this week across all their circles.
create or replace function get_university_leaderboard(p_university text, p_limit int default 50)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  is_pro boolean,
  best_streak integer,
  check_ins_this_week bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as user_id,
    p.handle,
    p.display_name,
    p.avatar_url,
    p.is_pro,
    coalesce((select max(gm.current_streak) from group_members gm where gm.user_id = p.id), 0) as best_streak,
    coalesce((
      select count(*) from check_ins ci
      where ci.user_id = p.id and ci.created_at >= date_trunc('week', now())
    ), 0) as check_ins_this_week
  from profiles p
  where p.university = p_university
  order by best_streak desc, check_ins_this_week desc, p.display_name asc
  limit p_limit;
$$;

-- ───────────────────────────── storage ─────────────────────────────
-- Bucket layout: check-in-photos/{group_id}/{user_id}/{check_in_id}.jpg
-- so policies can read the group id straight out of the object path.

insert into storage.buckets (id, name, public)
values ('check-in-photos', 'check-in-photos', false)
on conflict (id) do nothing;

drop policy if exists "check-in-photos: read if member" on storage.objects;
create policy "check-in-photos: read if member" on storage.objects for select
  using (
    bucket_id = 'check-in-photos'
    and is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "check-in-photos: upload own if member" on storage.objects;
create policy "check-in-photos: upload own if member" on storage.objects for insert
  with check (
    bucket_id = 'check-in-photos'
    and is_group_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ───────────────────────────── moderation ─────────────────────────────
-- Required for Google Play + Apple social-app review. Every report is preserved;
-- hard-delete only happens after a human moderator reviews it (see Tier B spec).
-- Admins query this via the Supabase Table Editor (service role bypasses RLS).

create table if not exists moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles (id) on delete set null,
  reported_check_in_id uuid references check_ins (id) on delete set null,
  reported_user_id uuid references profiles (id) on delete set null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists blocked_users (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table moderation_reports enable row level security;
alter table blocked_users enable row level security;

-- Authenticated users can file a report; only service role can read/update.
drop policy if exists "moderation_reports: insert own" on moderation_reports;
create policy "moderation_reports: insert own" on moderation_reports
  for insert with check (reporter_id = auth.uid());

-- Block: only see your own block list.
drop policy if exists "blocked_users: manage own" on blocked_users;
create policy "blocked_users: manage own" on blocked_users
  for all using (blocker_id = auth.uid());

-- ───────────────────────────── analytics views ─────────────────────────────
-- Query these from the Supabase SQL editor (service role bypasses RLS) — there's
-- no in-app dashboard for these on purpose. This is what decides when/how to charge.

create or replace view analytics_daily_signups as
select date_trunc('day', created_at)::date as day, count(*) as signups
from profiles
group by 1
order by 1;

create or replace view analytics_event_counts as
select name, date_trunc('day', created_at)::date as day, count(*) as count
from events
group by 1, 2
order by 2 desc, 1;

-- Per-signup-day-cohort D1/D7 retention. "Active" = fired any event on that calendar day.
create or replace view analytics_retention as
with signups as (
  select id as user_id, date_trunc('day', created_at)::date as signup_day
  from profiles
),
activity as (
  select user_id, date_trunc('day', created_at)::date as active_day
  from events
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

-- invites_accepted per signup — the "would they actually pull friends in" signal.
create or replace view analytics_viral_coefficient as
select
  (select count(*) from profiles) as total_signups,
  (select count(*) from events where name = 'invite_sent') as invites_sent,
  (select count(*) from events where name = 'invite_accepted') as invites_accepted,
  round(
    (select count(*) from events where name = 'invite_accepted')::numeric
    / greatest((select count(*) from profiles), 1),
    3
  ) as viral_coefficient;
